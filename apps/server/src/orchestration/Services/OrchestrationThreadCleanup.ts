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
 * Resync from the WebSocket only re-fetches whatever the projection currently
 * holds, so the bad rows survive every reconnect. This service is the
 * deliberate, user-triggered repair path: it removes those orphan rows in a
 * single transaction so the next snapshot the client pulls is internally
 * consistent.
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
}

/**
 * OrchestrationThreadCleanupShape - Service API for projection cleanup.
 */
export interface OrchestrationThreadCleanupShape {
  /**
   * Drop projection rows for `threadId` whose `turn_id` does not match any
   * existing row in `projection_turns` for the same thread.
   *
   * Rows whose `turn_id` is `NULL` (e.g. user-authored messages) are
   * intentionally retained — they are not turn-bound and so cannot be orphans
   * by this definition.
   *
   * Operates inside a single SQL transaction. Returns the count of rows
   * removed from each table so callers can surface a summary to the user.
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
