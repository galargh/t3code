/**
 * OrchestrationThreadCleanup - Service interface for repairing per-thread
 * projection inconsistencies that pure resync cannot fix.
 *
 * The orchestration projection tables (`projection_thread_activities`,
 * `projection_thread_messages`, `projection_thread_proposed_plans`) reference
 * `projection_turns` rows by `(thread_id, turn_id)`. Bugs in event ingestion
 * have historically left rows whose `turn_id` no longer matches any turn for
 * the thread — typically because the runtime emitted activity/message events
 * before (or in place of) the corresponding turn.start/turn.completed events.
 *
 * A second class of inconsistency lives in `projection_thread_sessions` and
 * `projection_turns` themselves: a session row with `status='running'` whose
 * `active_turn_id` points at a missing or terminal turn, and turn rows stuck
 * in `state='running'` with `completed_at IS NULL` after a newer turn has
 * already settled. These freeze the chat view's "Working for X" indicator
 * indefinitely.
 *
 * Resync from the WebSocket only re-fetches whatever the projection currently
 * holds, so the bad rows survive every reconnect. This service is the
 * deliberate, user-triggered repair path: it removes orphan rows AND repairs
 * the stale lifecycle state in a single transaction so the next snapshot the
 * client pulls is internally consistent.
 *
 * @module OrchestrationThreadCleanup
 */
import type { ThreadId } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface OrchestrationThreadCleanupCounts {
  readonly deletedActivities: number;
  readonly deletedMessages: number;
  readonly deletedProposedPlans: number;
  /**
   * 0 or 1. The thread's `projection_thread_sessions` row was reset to
   * `status='stopped'` (and `active_turn_id` cleared) because its
   * `active_turn_id` referenced a missing turn or a turn whose state was
   * terminal (`completed`/`error`/`interrupted`). Sessions that legitimately
   * point at a still-running turn are left untouched.
   */
  readonly resetSessions: number;
  /**
   * Number of `projection_turns` rows that were stuck in `state='running'`
   * with `completed_at IS NULL` while a strictly-newer turn had already
   * settled, and were therefore marked as `'interrupted'`.
   */
  readonly resetTurns: number;
}

/**
 * OrchestrationThreadCleanupShape - Service API for projection cleanup.
 */
export interface OrchestrationThreadCleanupShape {
  /**
   * Repair `threadId`'s projection rows in a single SQL transaction:
   *
   * 1. Drop activity / message / proposed-plan rows whose `turn_id` does not
   *    match any existing row in `projection_turns` for the same thread.
   *    Rows whose `turn_id` is `NULL` (e.g. user-authored messages) are
   *    intentionally retained — they are not turn-bound and so cannot be
   *    orphans by this definition.
   * 2. Reset the `projection_thread_sessions` row when `status` is
   *    `'running'` or `'starting'` and the referenced `active_turn_id` is
   *    missing or already terminal (`completed`/`error`/`interrupted`).
   *    Sets `status='stopped'`, clears `active_turn_id`, fills `last_error`
   *    if not already set.
   * 3. Mark turn rows that are stuck in `state='running'` with
   *    `completed_at IS NULL` as `'interrupted'` when a strictly-newer turn
   *    has already settled. The newest still-running turn is preserved in
   *    case it is genuinely in flight.
   *
   * Returns the count of rows touched by each step so callers can surface a
   * summary to the user.
   */
  readonly cleanupThreadOrphans: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThreadCleanupCounts, ProjectionRepositoryError>;
}

/**
 * OrchestrationThreadCleanup - Service tag for thread projection cleanup.
 */
export class OrchestrationThreadCleanup extends Context.Service<
  OrchestrationThreadCleanup,
  OrchestrationThreadCleanupShape
>()("t3/orchestration/Services/OrchestrationThreadCleanup") {}
