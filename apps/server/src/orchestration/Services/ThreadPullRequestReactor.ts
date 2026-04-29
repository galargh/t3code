/**
 * ThreadPullRequestReactor - Background reactor that keeps each thread's
 * cached PR snapshot (`thread.pr`) in sync with reality.
 *
 * Strategy: actively retain a `gitStatusBroadcaster.streamStatus(cwd)`
 * subscription for every cwd that has at least one effectively-unmuted
 * thread (project muted OR thread muted = no subscription). On
 * `remoteUpdated` events the reactor fans out to every matching thread
 * and dispatches `thread.pr-snapshot.set` whenever the snapshot changes
 * (fingerprint dedup excludes `refreshedAt` so heartbeats don't churn
 * the event log).
 *
 * Eager `findLatestPr` calls only happen on lifecycle events
 * (`thread.created`, branch/worktree change, unmute, unarchive) so a
 * fresh thread sees its PR icon before the user opens a detail panel.
 *
 * @module ThreadPullRequestReactor
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface ThreadPullRequestReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal worker queue is empty. Tests use this to
   * wait deterministically instead of sleeping.
   */
  readonly drain: Effect.Effect<void>;
}

export class ThreadPullRequestReactor extends Context.Service<
  ThreadPullRequestReactor,
  ThreadPullRequestReactorShape
>()("t3/orchestration/Services/ThreadPullRequestReactor") {}
