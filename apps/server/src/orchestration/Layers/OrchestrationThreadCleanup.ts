/**
 * OrchestrationThreadCleanupLive - SQLite-backed implementation of the
 * per-thread orphan cleanup service.
 *
 * Each cleanup runs inside a single SQL transaction. The DELETE/UPDATE
 * statements use `RETURNING` so we can report exact row counts back to the
 * caller; this lets the UI surface "deleted N orphan activities", "reset 1
 * stale session", etc. so the user knows the action actually changed
 * something.
 *
 * @module OrchestrationThreadCleanupLive
 */
import {
  EventId,
  MessageId,
  OrchestrationProposedPlanId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import {
  OrchestrationThreadCleanup,
  type OrchestrationThreadCleanupShape,
} from "../Services/OrchestrationThreadCleanup.ts";

const ThreadIdInput = Schema.Struct({ threadId: ThreadId });
const ThreadIdWithNowInput = Schema.Struct({ threadId: ThreadId, nowIso: Schema.String });

const DeletedActivityRow = Schema.Struct({ activityId: EventId });
const DeletedMessageRow = Schema.Struct({ messageId: MessageId });
const DeletedProposedPlanRow = Schema.Struct({ planId: OrchestrationProposedPlanId });
const ResetSessionRow = Schema.Struct({ threadId: ThreadId });
const ResetTurnRow = Schema.Struct({ turnId: TurnId });

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const STALE_SESSION_LAST_ERROR = "Reset by repair: stale active turn";

const makeOrchestrationThreadCleanup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Each statement deletes rows whose `turn_id` is set but does not match any
  // turn row for the same thread. `turn_id IS NULL` rows are user-authored
  // entries (e.g. user messages) and are never orphans by this definition, so
  // they are explicitly excluded from the predicate.
  const deleteOrphanActivities = SqlSchema.findAll({
    Request: ThreadIdInput,
    Result: DeletedActivityRow,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_activities
        WHERE thread_id = ${threadId}
          AND turn_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM projection_turns AS turns
            WHERE turns.thread_id = projection_thread_activities.thread_id
              AND turns.turn_id = projection_thread_activities.turn_id
          )
        RETURNING activity_id AS "activityId"
      `,
  });

  const deleteOrphanMessages = SqlSchema.findAll({
    Request: ThreadIdInput,
    Result: DeletedMessageRow,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_messages
        WHERE thread_id = ${threadId}
          AND turn_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM projection_turns AS turns
            WHERE turns.thread_id = projection_thread_messages.thread_id
              AND turns.turn_id = projection_thread_messages.turn_id
          )
        RETURNING message_id AS "messageId"
      `,
  });

  const deleteOrphanProposedPlans = SqlSchema.findAll({
    Request: ThreadIdInput,
    Result: DeletedProposedPlanRow,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_proposed_plans
        WHERE thread_id = ${threadId}
          AND turn_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM projection_turns AS turns
            WHERE turns.thread_id = projection_thread_proposed_plans.thread_id
              AND turns.turn_id = projection_thread_proposed_plans.turn_id
          )
        RETURNING plan_id AS "planId"
      `,
  });

  // Reset the session row when it is in a "running"/"starting" lifecycle but
  // the `active_turn_id` is missing or already terminal. Sessions that point
  // at a turn that is itself still `running`/`pending` are left alone so we
  // do not interrupt a genuinely-active session. We do NOT overwrite an
  // existing `last_error` (the original cause is more useful than ours).
  const resetStaleSession = SqlSchema.findAll({
    Request: ThreadIdWithNowInput,
    Result: ResetSessionRow,
    execute: ({ threadId, nowIso }) =>
      sql`
        UPDATE projection_thread_sessions
        SET status = 'stopped',
            active_turn_id = NULL,
            last_error = COALESCE(last_error, ${STALE_SESSION_LAST_ERROR}),
            updated_at = ${nowIso}
        WHERE thread_id = ${threadId}
          AND status IN ('running', 'starting')
          AND (
            active_turn_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM projection_turns AS t
              WHERE t.thread_id = projection_thread_sessions.thread_id
                AND t.turn_id = projection_thread_sessions.active_turn_id
            )
            OR EXISTS (
              SELECT 1 FROM projection_turns AS t
              WHERE t.thread_id = projection_thread_sessions.thread_id
                AND t.turn_id = projection_thread_sessions.active_turn_id
                AND t.state IN ('completed', 'error', 'interrupted')
            )
          )
        RETURNING thread_id AS "threadId"
      `,
  });

  // Mark turns as `'interrupted'` when they are stuck in `state='running'`
  // with no `completed_at` AND a strictly-newer turn for the same thread has
  // already settled. The "newer settled turn" guard means we never disturb
  // the most-recent running turn — it might still be in flight.
  const interruptStuckRunningTurns = SqlSchema.findAll({
    Request: ThreadIdWithNowInput,
    Result: ResetTurnRow,
    execute: ({ threadId, nowIso }) =>
      sql`
        UPDATE projection_turns
        SET state = 'interrupted',
            completed_at = ${nowIso}
        WHERE thread_id = ${threadId}
          AND state = 'running'
          AND completed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM projection_turns AS newer
            WHERE newer.thread_id = projection_turns.thread_id
              AND newer.requested_at > projection_turns.requested_at
              AND newer.state IN ('completed', 'error', 'interrupted')
          )
        RETURNING turn_id AS "turnId"
      `,
  });

  const cleanupThreadOrphans: OrchestrationThreadCleanupShape["cleanupThreadOrphans"] = (
    threadId,
  ) =>
    Effect.suspend(() => {
      const nowIso = new Date().toISOString();
      return sql
        .withTransaction(
          Effect.all(
            [
              deleteOrphanActivities({ threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:deleteActivities:query",
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:deleteActivities:decodeRows",
                  ),
                ),
              ),
              deleteOrphanMessages({ threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:deleteMessages:query",
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:deleteMessages:decodeRows",
                  ),
                ),
              ),
              deleteOrphanProposedPlans({ threadId }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:deleteProposedPlans:query",
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:deleteProposedPlans:decodeRows",
                  ),
                ),
              ),
              interruptStuckRunningTurns({ threadId, nowIso }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:interruptTurns:query",
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:interruptTurns:decodeRows",
                  ),
                ),
              ),
              resetStaleSession({ threadId, nowIso }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:resetSession:query",
                    "OrchestrationThreadCleanup.cleanupThreadOrphans:resetSession:decodeRows",
                  ),
                ),
              ),
            ],
            // Run sequentially to keep deterministic ordering inside the
            // transaction. Stuck-turn interruption runs BEFORE the session
            // reset so that the session's predicate sees the already-updated
            // turn states (a turn we just flipped to `'interrupted'` makes
            // its session row eligible for reset on the same call).
            { concurrency: 1 },
          ),
        )
        .pipe(
          Effect.map(([activityRows, messageRows, planRows, turnRows, sessionRows]) => ({
            deletedActivities: activityRows.length,
            deletedMessages: messageRows.length,
            deletedProposedPlans: planRows.length,
            resetSessions: sessionRows.length,
            resetTurns: turnRows.length,
          })),
          Effect.mapError((error) => {
            if (isPersistenceError(error)) {
              return error;
            }
            return toPersistenceSqlError(
              "OrchestrationThreadCleanup.cleanupThreadOrphans:transaction",
            )(error);
          }),
        );
    });

  return {
    cleanupThreadOrphans,
  } satisfies OrchestrationThreadCleanupShape;
});

export const OrchestrationThreadCleanupLive = Layer.effect(
  OrchestrationThreadCleanup,
  makeOrchestrationThreadCleanup,
);
