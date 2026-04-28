/**
 * OrchestrationThreadCleanupLive - SQLite-backed implementation of the
 * per-thread orphan cleanup service.
 *
 * Each cleanup runs inside a single SQL transaction. The DELETE statements use
 * `RETURNING` so we can report exact row counts back to the caller; this lets
 * the UI surface "deleted N orphan activities" so the user knows the action
 * actually changed something.
 *
 * @module OrchestrationThreadCleanupLive
 */
import { EventId, MessageId, OrchestrationProposedPlanId, ThreadId } from "@t3tools/contracts";
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

const DeletedActivityRow = Schema.Struct({ activityId: EventId });
const DeletedMessageRow = Schema.Struct({ messageId: MessageId });
const DeletedProposedPlanRow = Schema.Struct({ planId: OrchestrationProposedPlanId });

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

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

  const cleanupThreadOrphans: OrchestrationThreadCleanupShape["cleanupThreadOrphans"] = (
    threadId,
  ) =>
    sql
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
          ],
          { concurrency: 1 },
        ),
      )
      .pipe(
        Effect.map(([activityRows, messageRows, planRows]) => ({
          deletedActivities: activityRows.length,
          deletedMessages: messageRows.length,
          deletedProposedPlans: planRows.length,
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

  return {
    cleanupThreadOrphans,
  } satisfies OrchestrationThreadCleanupShape;
});

export const OrchestrationThreadCleanupLive = Layer.effect(
  OrchestrationThreadCleanup,
  makeOrchestrationThreadCleanup,
);
