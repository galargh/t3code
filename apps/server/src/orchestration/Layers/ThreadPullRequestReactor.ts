/**
 * ThreadPullRequestReactor (Live) - Keeps `thread.pr` snapshots in sync.
 *
 * Owns one `gitStatusBroadcaster.streamStatus(cwd)` subscription per cwd
 * that has at least one effectively-unmuted thread (project muted OR thread
 * muted = no subscription). Subscriptions are ref-counted by the number of
 * unmuted threads on each cwd; when that count drops to zero the
 * subscription is interrupted and the broadcaster stops polling.
 *
 * Refresh paths:
 *  - **Passive**: broadcaster `remoteUpdated` events fan out to every
 *    matching unmuted thread on the cwd, fingerprint-deduped against the
 *    current projection so unchanged PR state never produces an event.
 *  - **Eager**: lifecycle events (`thread.created`, `thread.meta-updated`
 *    branch/worktree change, `thread.unmuted`, `thread.unarchived`,
 *    `project.unmuted`) trigger a single direct `findLatestPr` call so the
 *    sidebar PR icon appears immediately for new/just-unmuted threads
 *    without waiting for the next broadcaster poll.
 */
import {
  CommandId,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationThread,
  type OrchestrationThreadPrSnapshot,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { Cause, Effect, Exit, Fiber, Layer, Scope, Stream, SynchronizedRef } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { GitManager } from "../../git/Services/GitManager.ts";
import {
  GitStatusBroadcaster,
  type GitStatusBroadcasterShape,
} from "../../git/Services/GitStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadPullRequestReactor,
  type ThreadPullRequestReactorShape,
} from "../Services/ThreadPullRequestReactor.ts";

interface CwdSubscription {
  readonly fiber: Fiber.Fiber<void, never>;
  readonly threadCount: number;
}

type ReactorTask =
  | { readonly kind: "broadcaster"; readonly cwd: string; readonly pr: BroadcasterPr | null }
  | { readonly kind: "refreshThread"; readonly threadId: ThreadId }
  | { readonly kind: "refreshProject"; readonly projectId: ProjectId };

type BroadcasterPr =
  NonNullable<
    Parameters<GitStatusBroadcasterShape["streamStatus"]>[0] extends never ? never : never
  > extends never
    ? {
        readonly number: number;
        readonly title: string;
        readonly url: string;
        readonly baseBranch: string;
        readonly headBranch: string;
        readonly state: "open" | "queued" | "closed" | "merged";
      }
    : never;

const isThreadEffectivelyMuted = (
  thread: { readonly mutedAt: string | null },
  project: { readonly mutedAt: string | null } | undefined,
): boolean => thread.mutedAt !== null || (project?.mutedAt ?? null) !== null;

const computeThreadCwd = (
  thread: Pick<OrchestrationThread, "worktreePath">,
  project: Pick<OrchestrationProject, "workspaceRoot"> | undefined,
): string | null => thread.worktreePath ?? project?.workspaceRoot ?? null;

/**
 * Fingerprint excludes `refreshedAt` so broadcaster heartbeats don't churn
 * the event log when nothing meaningful changed.
 */
function prFingerprint(pr: OrchestrationThreadPrSnapshot | null): string {
  if (pr === null) return "null";
  return `${pr.number}|${pr.state}|${pr.url}|${pr.title}|${pr.baseBranch}|${pr.headBranch}|${pr.branch}`;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;
  const gitManager = yield* GitManager;

  const reactorScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );

  const subscriptionsRef = yield* SynchronizedRef.make(new Map<string, CwdSubscription>());

  const dispatchSetPr = (threadId: ThreadId, pr: OrchestrationThreadPrSnapshot | null) =>
    orchestrationEngine
      .dispatch({
        type: "thread.pr-snapshot.set",
        commandId: CommandId.make(crypto.randomUUID()),
        threadId,
        pr,
        createdAt: new Date().toISOString(),
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("ThreadPullRequestReactor: dispatch failed", {
            threadId,
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.asVoid,
      );

  const propagateBroadcasterPr = Effect.fn("ThreadPullRequestReactor.propagateBroadcasterPr")(
    function* (cwd: string, pr: BroadcasterPr | null) {
      const readModel = yield* orchestrationEngine.getReadModel();
      const projectsById = new Map(readModel.projects.map((p) => [p.id, p] as const));
      const matching = readModel.threads.filter((thread) => {
        if (thread.deletedAt !== null || thread.archivedAt !== null) return false;
        const project = projectsById.get(thread.projectId);
        if (isThreadEffectivelyMuted(thread, project)) return false;
        if (computeThreadCwd(thread, project) !== cwd) return false;
        // For threads on a shared cwd, only update those whose branch matches
        // the broadcaster's current branch (otherwise we'd be pasting a PR
        // for someone else's branch).
        if (pr !== null && pr.headBranch !== thread.branch) return false;
        return true;
      });

      yield* Effect.forEach(
        matching,
        (thread) => {
          const next: OrchestrationThreadPrSnapshot | null =
            pr === null || thread.branch === null
              ? null
              : {
                  number: pr.number,
                  title: pr.title,
                  url: pr.url,
                  state: pr.state,
                  baseBranch: pr.baseBranch,
                  headBranch: pr.headBranch,
                  branch: thread.branch,
                  refreshedAt: new Date().toISOString(),
                };
          if (prFingerprint(next) === prFingerprint(thread.pr)) return Effect.void;
          return dispatchSetPr(thread.id, next);
        },
        { concurrency: 4 },
      );
    },
  );

  const refreshThread = Effect.fn("ThreadPullRequestReactor.refreshThread")(function* (
    threadId: ThreadId,
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) return;
    const project = readModel.projects.find((entry) => entry.id === thread.projectId);
    if (isThreadEffectivelyMuted(thread, project)) {
      // Muted threads keep their last-known PR — never refresh.
      return;
    }
    if (thread.branch === null) {
      if (thread.pr !== null) yield* dispatchSetPr(threadId, null);
      return;
    }
    const cwd = computeThreadCwd(thread, project);
    if (cwd === null) return;

    const result = yield* gitManager
      .findLatestPr({ cwd, branch: thread.branch, upstreamRef: null })
      .pipe(Effect.catch(() => Effect.succeed(null)));

    const next: OrchestrationThreadPrSnapshot | null =
      result === null
        ? null
        : {
            number: result.number,
            title: result.title,
            url: result.url,
            state: result.state,
            baseBranch: result.baseRefName,
            headBranch: result.headRefName,
            branch: thread.branch,
            refreshedAt: new Date().toISOString(),
          };

    if (prFingerprint(next) === prFingerprint(thread.pr)) return;
    yield* dispatchSetPr(threadId, next);
  });

  const refreshProject = Effect.fn("ThreadPullRequestReactor.refreshProject")(function* (
    projectId: ProjectId,
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const targets = readModel.threads.filter(
      (thread) =>
        thread.projectId === projectId &&
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        thread.mutedAt === null,
    );
    yield* Effect.forEach(targets, (thread) => refreshThread(thread.id), { concurrency: 4 });
  });

  const processTaskSafely = (task: ReactorTask) => {
    const inner =
      task.kind === "broadcaster"
        ? propagateBroadcasterPr(task.cwd, task.pr)
        : task.kind === "refreshThread"
          ? refreshThread(task.threadId)
          : refreshProject(task.projectId);
    return inner.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("ThreadPullRequestReactor: failed to process task", {
          kind: task.kind,
          cause: Cause.pretty(cause),
        });
      }),
    );
  };

  const worker = yield* makeDrainableWorker(processTaskSafely);

  const subscribeCwdLoop = (cwd: string): Effect.Effect<void, never> =>
    gitStatusBroadcaster.streamStatus({ cwd }).pipe(
      Stream.runForEach((event) => {
        if (event._tag === "remoteUpdated") {
          return worker.enqueue({
            kind: "broadcaster",
            cwd,
            pr: event.remote?.pr ?? null,
          });
        }
        return Effect.void;
      }),
      Effect.catch((error) =>
        Effect.logWarning("ThreadPullRequestReactor: cwd subscription failed", {
          cwd,
          detail: error.message,
        }),
      ),
    );

  const retainCwdSubscription = (cwd: string) =>
    SynchronizedRef.modifyEffect(subscriptionsRef, (active) => {
      const existing = active.get(cwd);
      if (existing) {
        const next = new Map(active);
        next.set(cwd, { ...existing, threadCount: existing.threadCount + 1 });
        return Effect.succeed([undefined, next] as const);
      }
      return subscribeCwdLoop(cwd).pipe(
        Effect.forkIn(reactorScope),
        Effect.map((fiber) => {
          const next = new Map(active);
          next.set(cwd, { fiber, threadCount: 1 });
          return [undefined, next] as const;
        }),
      );
    });

  const releaseCwdSubscription = (cwd: string) =>
    Effect.gen(function* () {
      const interrupt = yield* SynchronizedRef.modify(subscriptionsRef, (active) => {
        const existing = active.get(cwd);
        if (!existing) {
          return [null as Fiber.Fiber<void, never> | null, active] as const;
        }
        if (existing.threadCount > 1) {
          const next = new Map(active);
          next.set(cwd, { ...existing, threadCount: existing.threadCount - 1 });
          return [null as Fiber.Fiber<void, never> | null, next] as const;
        }
        const next = new Map(active);
        next.delete(cwd);
        return [existing.fiber, next] as const;
      });
      if (interrupt) {
        yield* Fiber.interrupt(interrupt).pipe(Effect.ignore);
      }
    });

  /**
   * Reconcile the cwd subscription holdings for a single thread by reading
   * its current state in the projection. Used after `thread.created`,
   * `thread.meta-updated`, `thread.muted`, `thread.unmuted`, `thread.archived`,
   * `thread.unarchived`, and `thread.deleted` events.
   *
   * `expectedHolding` is the reactor's previous record of whether it held a
   * subscription on this thread's prior cwd; when the cwd changes we must
   * release the old before acquiring the new.
   */
  const threadHoldings = yield* SynchronizedRef.make(new Map<ThreadId, string>());

  const reconcileThreadHolding = Effect.fn("ThreadPullRequestReactor.reconcileThreadHolding")(
    function* (threadId: ThreadId) {
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === threadId);
      const project = thread
        ? readModel.projects.find((entry) => entry.id === thread.projectId)
        : undefined;
      const desiredCwd =
        thread &&
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        !isThreadEffectivelyMuted(thread, project)
          ? computeThreadCwd(thread, project)
          : null;

      const previousCwd = yield* SynchronizedRef.modify(threadHoldings, (holdings) => {
        const prev = holdings.get(threadId) ?? null;
        const next = new Map(holdings);
        if (desiredCwd === null) next.delete(threadId);
        else next.set(threadId, desiredCwd);
        return [prev, next] as const;
      });

      if (previousCwd === desiredCwd) return;
      if (previousCwd !== null) yield* releaseCwdSubscription(previousCwd);
      if (desiredCwd !== null) yield* retainCwdSubscription(desiredCwd);
    },
  );

  const reconcileProjectHoldings = Effect.fn("ThreadPullRequestReactor.reconcileProjectHoldings")(
    function* (projectId: ProjectId) {
      const readModel = yield* orchestrationEngine.getReadModel();
      const targets = readModel.threads.filter((thread) => thread.projectId === projectId);
      yield* Effect.forEach(targets, (thread) => reconcileThreadHolding(thread.id), {
        concurrency: 4,
      });
    },
  );

  const handleDomainEvent = (event: OrchestrationEvent) => {
    switch (event.type) {
      case "thread.created":
        return Effect.zip(
          reconcileThreadHolding(event.payload.threadId),
          worker.enqueue({ kind: "refreshThread", threadId: event.payload.threadId }),
        ).pipe(Effect.asVoid);
      case "thread.meta-updated":
        if (event.payload.branch === undefined && event.payload.worktreePath === undefined) {
          return Effect.void;
        }
        return Effect.zip(
          reconcileThreadHolding(event.payload.threadId),
          worker.enqueue({ kind: "refreshThread", threadId: event.payload.threadId }),
        ).pipe(Effect.asVoid);
      case "thread.muted":
      case "thread.archived":
      case "thread.deleted":
        return reconcileThreadHolding(event.payload.threadId);
      case "thread.unmuted":
      case "thread.unarchived":
        return Effect.zip(
          reconcileThreadHolding(event.payload.threadId),
          worker.enqueue({ kind: "refreshThread", threadId: event.payload.threadId }),
        ).pipe(Effect.asVoid);
      case "project.muted":
        return reconcileProjectHoldings(event.payload.projectId);
      case "project.unmuted":
        return Effect.zip(
          reconcileProjectHoldings(event.payload.projectId),
          worker.enqueue({ kind: "refreshProject", projectId: event.payload.projectId }),
        ).pipe(Effect.asVoid);
      default:
        return Effect.void;
    }
  };

  const start: ThreadPullRequestReactorShape["start"] = Effect.fn("start")(function* () {
    // Startup pass: subscribe per cwd for every effectively-unmuted live
    // thread. The broadcaster's first poll fans out as remoteUpdated which
    // becomes initial backfill.
    const initial = yield* orchestrationEngine.getReadModel();
    const projectsById = new Map(initial.projects.map((p) => [p.id, p] as const));
    yield* Effect.forEach(
      initial.threads,
      (thread) => {
        if (thread.deletedAt !== null || thread.archivedAt !== null) return Effect.void;
        const project = projectsById.get(thread.projectId);
        if (isThreadEffectivelyMuted(thread, project)) return Effect.void;
        const cwd = computeThreadCwd(thread, project);
        if (cwd === null) return Effect.void;
        return SynchronizedRef.update(threadHoldings, (holdings) => {
          const next = new Map(holdings);
          next.set(thread.id, cwd);
          return next;
        }).pipe(Effect.flatMap(() => retainCwdSubscription(cwd)));
      },
      { concurrency: "unbounded" },
    );

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, handleDomainEvent),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ThreadPullRequestReactorShape;
});

export const ThreadPullRequestReactorLive = Layer.effect(ThreadPullRequestReactor, make);
