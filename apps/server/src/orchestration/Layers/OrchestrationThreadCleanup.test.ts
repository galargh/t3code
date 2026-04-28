import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationThreadCleanupLive } from "./OrchestrationThreadCleanup.ts";
import { OrchestrationThreadCleanup } from "../Services/OrchestrationThreadCleanup.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const cleanupLayer = it.layer(
  OrchestrationThreadCleanupLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

/**
 * Inserts a minimal valid `projection_threads` + `projection_projects` pair so
 * later inserts that JOIN onto `projection_threads` (or rely on the row's
 * existence implicitly) work, plus optionally pre-populates a single
 * `projection_turns` row whose presence determines whether downstream rows are
 * orphans.
 */
const seedThread = (
  sql: SqlClient.SqlClient,
  options: {
    readonly threadId: string;
    readonly turnIds?: ReadonlyArray<string>;
  },
) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, default_model_selection_json, scripts_json,
        created_at, updated_at, deleted_at
      )
      VALUES (
        'project-1', 'Project 1', '/tmp/project-1',
        '{"provider":"codex","model":"gpt-5-codex"}', '[]',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
      )
      ON CONFLICT (project_id) DO NOTHING
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id,
        latest_user_message_at, pending_approval_count, pending_user_input_count,
        has_actionable_proposed_plan, created_at, updated_at, deleted_at
      )
      VALUES (
        ${options.threadId}, 'project-1', 'Thread', '{"provider":"codex","model":"gpt-5-codex"}',
        'full-access', 'default', NULL, NULL, NULL, NULL, 0, 0, 0,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
      )
    `;
    for (const turnId of options.turnIds ?? []) {
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id,
          source_proposed_plan_thread_id, source_proposed_plan_id, assistant_message_id,
          state, requested_at, started_at, completed_at,
          checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json
        )
        VALUES (
          ${options.threadId}, ${turnId}, NULL, NULL, NULL, NULL,
          'completed',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
          NULL, NULL, NULL, '[]'
        )
      `;
    }
  });

cleanupLayer("OrchestrationThreadCleanup", (it) => {
  it.effect(
    "deletes activities/messages/proposed plans whose turn_id no longer exists in projection_turns",
    () =>
      Effect.gen(function* () {
        const cleanup = yield* OrchestrationThreadCleanup;
        const sql = yield* SqlClient.SqlClient;

        // Reset all projection tables for a clean slate.
        yield* sql`DELETE FROM projection_thread_activities`;
        yield* sql`DELETE FROM projection_thread_messages`;
        yield* sql`DELETE FROM projection_thread_proposed_plans`;
        yield* sql`DELETE FROM projection_thread_sessions`;
        yield* sql`DELETE FROM projection_turns`;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_projects`;

        // Real turn for the thread; references to this turnId are valid.
        yield* seedThread(sql, { threadId: "thread-1", turnIds: ["turn-real"] });

        // Orphan activities that point at turns that never made it into
        // projection_turns. This mirrors the live-data bug where a runtime
        // crashed mid-turn before turn-start was persisted.
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
          ) VALUES
            ('act-real', 'thread-1', 'turn-real', 'info', 'runtime.note', 'ok', '{}', '2026-01-01T00:01:00.000Z'),
            ('act-orphan-1', 'thread-1', 'turn-ghost', 'info', 'runtime.note', 'orphan', '{}', '2026-01-01T00:02:00.000Z'),
            ('act-orphan-2', 'thread-1', 'turn-ghost-2', 'info', 'runtime.note', 'orphan', '{}', '2026-01-01T00:03:00.000Z')
        `;

        // Orphan assistant message bound to a non-existent turn. Plus an
        // intentionally-NULL turn_id user message which must be retained.
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, attachments_json, is_streaming,
            created_at, updated_at
          ) VALUES
            ('msg-real', 'thread-1', 'turn-real', 'assistant', 'kept', NULL, 0,
             '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z'),
            ('msg-orphan', 'thread-1', 'turn-ghost', 'assistant', 'orphan', NULL, 0,
             '2026-01-01T00:02:00.000Z', '2026-01-01T00:02:00.000Z'),
            ('msg-user', 'thread-1', NULL, 'user', 'a user message', NULL, 0,
             '2026-01-01T00:00:30.000Z', '2026-01-01T00:00:30.000Z')
        `;

        yield* sql`
          INSERT INTO projection_thread_proposed_plans (
            plan_id, thread_id, turn_id, plan_markdown, implemented_at,
            implementation_thread_id, created_at, updated_at
          ) VALUES
            ('plan-real', 'thread-1', 'turn-real', '# kept', NULL, NULL,
             '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z'),
            ('plan-orphan', 'thread-1', 'turn-ghost', '# orphan', NULL, NULL,
             '2026-01-01T00:02:00.000Z', '2026-01-01T00:02:00.000Z')
        `;

        // A second thread with its own orphan, to prove the cleanup is scoped
        // by threadId and does not bleed across threads.
        yield* seedThread(sql, { threadId: "thread-2", turnIds: [] });
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
          ) VALUES
            ('act-other-orphan', 'thread-2', 'turn-ghost', 'info', 'runtime.note', 'do not touch',
             '{}', '2026-01-01T00:02:00.000Z')
        `;

        const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-1"));

        assert.deepStrictEqual(result, {
          deletedActivities: 2,
          deletedMessages: 1,
          deletedProposedPlans: 1,
        });

        const [activities, messages, plans, otherActivities] = yield* Effect.all([
          sql<{ readonly activity_id: string }>`
            SELECT activity_id FROM projection_thread_activities WHERE thread_id = 'thread-1' ORDER BY activity_id
          `,
          sql<{ readonly message_id: string }>`
            SELECT message_id FROM projection_thread_messages WHERE thread_id = 'thread-1' ORDER BY message_id
          `,
          sql<{ readonly plan_id: string }>`
            SELECT plan_id FROM projection_thread_proposed_plans WHERE thread_id = 'thread-1' ORDER BY plan_id
          `,
          sql<{ readonly activity_id: string }>`
            SELECT activity_id FROM projection_thread_activities WHERE thread_id = 'thread-2' ORDER BY activity_id
          `,
        ]);

        assert.deepStrictEqual(
          activities.map((row) => row.activity_id),
          ["act-real"],
        );
        // The user message (NULL turn_id) must stay untouched.
        assert.deepStrictEqual(
          messages.map((row) => row.message_id),
          ["msg-real", "msg-user"],
        );
        assert.deepStrictEqual(
          plans.map((row) => row.plan_id),
          ["plan-real"],
        );
        assert.deepStrictEqual(
          otherActivities.map((row) => row.activity_id),
          ["act-other-orphan"],
        );
      }),
  );

  it.effect("returns zero counts when there is nothing to clean up", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;

      yield* seedThread(sql, { threadId: "thread-clean", turnIds: ["turn-1"] });
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
        ) VALUES
          ('act-1', 'thread-clean', 'turn-1', 'info', 'runtime.note', 'ok', '{}',
           '2026-01-01T00:01:00.000Z')
      `;

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-clean"));

      assert.deepStrictEqual(result, {
        deletedActivities: 0,
        deletedMessages: 0,
        deletedProposedPlans: 0,
      });
    }),
  );

  it.effect("returns zero counts when the thread has no projection rows at all", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-missing"));

      assert.deepStrictEqual(result, {
        deletedActivities: 0,
        deletedMessages: 0,
        deletedProposedPlans: 0,
      });
    }),
  );
});
