import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { truncate } from "@t3tools/shared/String";
import { useEffect, useRef } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { useGitStatus } from "../lib/gitStatusState";
import { newCommandId } from "~/lib/utils";

interface UsePrTitleSyncArgs {
  /** Active server thread id; pass `null` to disable sync (e.g. on draft threads). */
  threadId: ThreadId | null;
  /** Current stored title of the thread; used to skip dispatching when it already matches. */
  currentTitle: string | null;
  environmentId: EnvironmentId | null;
  /**
   * Worktree path (preferred) or project cwd. Same convention as `PrPanel`/`ChatHeader`:
   * `thread.worktreePath ?? activeProject.cwd`.
   */
  cwd: string | null;
}

/**
 * Pure helper deciding whether (and what) to dispatch as the next thread title.
 *
 * Returns the truncated PR title when a PR exists, has a non-empty truncated title, and that
 * title differs from the thread's current title. Returns `null` to mean "no dispatch".
 *
 * Exported for unit tests.
 */
export function derivePrTitleSyncDispatch(
  currentTitle: string | null,
  prTitle: string | null | undefined,
): string | null {
  if (!prTitle) {
    return null;
  }
  const nextTitle = truncate(prTitle);
  if (nextTitle.length === 0) {
    return null;
  }
  if (nextTitle === currentTitle) {
    return null;
  }
  return nextTitle;
}

/**
 * Whenever git status reveals a pull request for the active thread's branch, force the
 * thread title to match the PR title. Covers both initial discovery (PR checkout) and
 * ongoing sync (upstream PR title changes, manual rename revert).
 *
 * No-op for drafts (`threadId === null`), missing environment, or threads without a
 * resolved PR.
 *
 * The first-turn LLM auto-rename in `ProviderCommandReactor.canReplaceThreadTitle` is
 * naturally suppressed once the PR title overwrites the message-derived title (since the
 * stored title then matches neither `"New thread"` nor the original `titleSeed`).
 */
export function usePrTitleSync(args: UsePrTitleSyncArgs): void {
  const { threadId, currentTitle, environmentId, cwd } = args;

  // Reuse the ref-counted git-status subscription. If the call site already mounts
  // `useGitStatus` for this `cwd`, the underlying subscription is shared.
  const gitStatus = useGitStatus({ environmentId, cwd });
  const prTitle = gitStatus.data?.pr?.title ?? null;

  // In-flight de-dup: avoid re-dispatching the same title while the server round-trip
  // is pending. Cleared once the server-applied title catches up. Per-thread.
  const lastDispatchedRef = useRef<string | null>(null);
  const lastTargetThreadIdRef = useRef<ThreadId | null>(null);

  useEffect(() => {
    if (lastTargetThreadIdRef.current !== threadId) {
      lastTargetThreadIdRef.current = threadId;
      lastDispatchedRef.current = null;
    }

    if (threadId === null || environmentId === null) {
      return;
    }

    // Once the server has applied our previous dispatch, clear the guard so a later
    // user-initiated rename (which "always sync" semantics should revert) re-fires.
    if (currentTitle === lastDispatchedRef.current) {
      lastDispatchedRef.current = null;
    }

    const nextTitle = derivePrTitleSyncDispatch(currentTitle, prTitle);
    if (nextTitle === null) {
      return;
    }
    if (nextTitle === lastDispatchedRef.current) {
      return;
    }

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      return;
    }

    lastDispatchedRef.current = nextTitle;
    void api.orchestration.dispatchCommand({
      type: "thread.meta.update",
      commandId: newCommandId(),
      threadId,
      title: nextTitle,
    });
  }, [threadId, currentTitle, environmentId, prTitle]);
}
