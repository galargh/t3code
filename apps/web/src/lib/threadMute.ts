/**
 * Effective-mute helper for threads.
 *
 * A thread is effectively muted iff its own `mutedAt` is set, OR the project
 * containing it has its own `mutedAt` set. Project mute is the killswitch:
 * unmuting the project restores per-thread `mutedAt` state (which is preserved
 * underneath project mute).
 *
 * Used by the sidebar (visual indicator) and detail panels (skip
 * `useGitStatus` subscription when muted).
 *
 * @module threadMute
 */

export interface ThreadMuteState {
  readonly mutedAt?: string | null;
}

export interface ProjectMuteState {
  readonly mutedAt?: string | null;
}

export function isThreadEffectivelyMuted(
  thread: ThreadMuteState,
  project: ProjectMuteState | null | undefined,
): boolean {
  if (thread.mutedAt != null) return true;
  if (project?.mutedAt != null) return true;
  return false;
}
