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

interface SeedTurn {
  readonly turnId: string;
  readonly state?: "pending" | "running" | "interrupted" | "completed" | "error";
  readonly requestedAt?: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

/**
 * Inserts a minimal valid `projection_threads` + `projection_projects` pair so
 * later inserts that JOIN onto `projection_threads` (or rely on the row's
 * existence implicitly) work, plus optionally pre-populates `projection_turns`
 * rows whose presence determines whether downstream rows are orphans.
 *
 * Each turn defaults to `state='completed'` with all timestamps at
 * `2026-01-01T00:00:00.000Z`; pass `SeedTurn` objects to override any field.
 */
const seedThread = (
  sql: SqlClient.SqlClient,
  options: {
    readonly threadId: string;
    readonly turnIds?: ReadonlyArray<string | SeedTurn>;
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
    for (const entry of options.turnIds ?? []) {
      const turn: SeedTurn = typeof entry === "string" ? { turnId: entry } : entry;
      const state = turn.state ?? "completed";
      const requestedAt = turn.requestedAt ?? "2026-01-01T00:00:00.000Z";
      const startedAt = turn.startedAt === undefined ? "2026-01-01T00:00:00.000Z" : turn.startedAt;
      const completedAt =
        turn.completedAt === undefined ? "2026-01-01T00:00:00.000Z" : turn.completedAt;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id,
          source_proposed_plan_thread_id, source_proposed_plan_id, assistant_message_id,
          state, requested_at, started_at, completed_at,
          checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json
        )
        VALUES (
          ${options.threadId}, ${turn.turnId}, NULL, NULL, NULL, NULL,
          ${state},
          ${requestedAt}, ${startedAt}, ${completedAt},
          NULL, NULL, NULL, '[]'
        )
      `;
    }
  });

interface SeedSession {
  readonly threadId: string;
  readonly status: string;
  readonly activeTurnId?: string | null;
  readonly lastError?: string | null;
  readonly updatedAt?: string;
}

const seedSession = (sql: SqlClient.SqlClient, options: SeedSession) =>
  sql`
    INSERT INTO projection_thread_sessions (
      thread_id, status, provider_name, provider_session_id, provider_thread_id,
      active_turn_id, last_error, updated_at, runtime_mode
    )
    VALUES (
      ${options.threadId}, ${options.status}, 'codex', NULL, NULL,
      ${options.activeTurnId ?? null}, ${options.lastError ?? null},
      ${options.updatedAt ?? "2026-01-01T00:00:00.000Z"}, 'full-access'
    )
    ON CONFLICT (thread_id) DO UPDATE SET
      status = excluded.status,
      active_turn_id = excluded.active_turn_id,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `;

const resetAllTables = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* sql`DELETE FROM projection_thread_activities`;
    yield* sql`DELETE FROM projection_thread_messages`;
    yield* sql`DELETE FROM projection_thread_proposed_plans`;
    yield* sql`DELETE FROM projection_thread_sessions`;
    yield* sql`DELETE FROM projection_turns`;
    yield* sql`DELETE FROM projection_threads`;
    yield* sql`DELETE FROM projection_projects`;
  });

interface SessionRow {
  readonly status: string;
  readonly active_turn_id: string | null;
  readonly last_error: string | null;
  readonly updated_at: string;
}

const fetchSession = (sql: SqlClient.SqlClient, threadId: string) =>
  sql<SessionRow>`
    SELECT status, active_turn_id, last_error, updated_at
    FROM projection_thread_sessions
    WHERE thread_id = ${threadId}
  `;

interface TurnRow {
  readonly turn_id: string | null;
  readonly state: string;
  readonly completed_at: string | null;
}

const fetchTurns = (sql: SqlClient.SqlClient, threadId: string) =>
  sql<TurnRow>`
    SELECT turn_id, state, completed_at
    FROM projection_turns
    WHERE thread_id = ${threadId}
    ORDER BY requested_at ASC, turn_id ASC
  `;

cleanupLayer("OrchestrationThreadCleanup", (it) => {
  it.effect(
    "deletes activities/messages/proposed plans whose turn_id no longer exists in projection_turns",
    () =>
      Effect.gen(function* () {
        const cleanup = yield* OrchestrationThreadCleanup;
        const sql = yield* SqlClient.SqlClient;

        yield* resetAllTables(sql);

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
          resetSessions: 0,
          resetTurns: 0,
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

      yield* resetAllTables(sql);

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
        resetSessions: 0,
        resetTurns: 0,
      });
    }),
  );

  it.effect("returns zero counts when the thread has no projection rows at all", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-missing"));

      assert.deepStrictEqual(result, {
        deletedActivities: 0,
        deletedMessages: 0,
        deletedProposedPlans: 0,
        resetSessions: 0,
        resetTurns: 0,
      });
    }),
  );

  it.effect("resets a stale running session whose active_turn_id references a completed turn", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-stuck",
        turnIds: [
          {
            turnId: "turn-old",
            state: "completed",
            requestedAt: "2026-04-28T15:56:45.199Z",
            completedAt: "2026-04-28T15:56:58.036Z",
          },
        ],
      });
      yield* seedSession(sql, {
        threadId: "thread-stuck",
        status: "running",
        activeTurnId: "turn-old",
        updatedAt: "2026-04-28T22:04:04.938Z",
      });

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-stuck"));

      assert.strictEqual(result.resetSessions, 1);
      assert.strictEqual(result.resetTurns, 0);

      const [session] = yield* fetchSession(sql, "thread-stuck");
      assert.ok(session, "session row should still exist");
      assert.strictEqual(session.status, "stopped");
      assert.strictEqual(session.active_turn_id, null);
      assert.strictEqual(session.last_error, "Reset by repair: stale active turn");
      assert.notStrictEqual(
        session.updated_at,
        "2026-04-28T22:04:04.938Z",
        "updated_at should advance to the repair timestamp",
      );
    }),
  );

  it.effect("resets a stale running session whose active_turn_id is NULL", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, { threadId: "thread-null-turn", turnIds: [] });
      yield* seedSession(sql, {
        threadId: "thread-null-turn",
        status: "running",
        activeTurnId: null,
      });

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-null-turn"));

      assert.strictEqual(result.resetSessions, 1);
      const [session] = yield* fetchSession(sql, "thread-null-turn");
      assert.ok(session);
      assert.strictEqual(session.status, "stopped");
      assert.strictEqual(session.active_turn_id, null);
    }),
  );

  it.effect(
    "resets a stale running session whose active_turn_id references a turn that doesn't exist",
    () =>
      Effect.gen(function* () {
        const cleanup = yield* OrchestrationThreadCleanup;
        const sql = yield* SqlClient.SqlClient;

        yield* resetAllTables(sql);
        yield* seedThread(sql, { threadId: "thread-ghost-turn", turnIds: [] });
        yield* seedSession(sql, {
          threadId: "thread-ghost-turn",
          status: "running",
          activeTurnId: "turn-ghost",
        });

        const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-ghost-turn"));

        assert.strictEqual(result.resetSessions, 1);
        const [session] = yield* fetchSession(sql, "thread-ghost-turn");
        assert.ok(session);
        assert.strictEqual(session.status, "stopped");
        assert.strictEqual(session.active_turn_id, null);
      }),
  );

  it.effect("resets a stale starting session (status='starting') the same way as 'running'", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-starting",
        turnIds: [{ turnId: "turn-finished", state: "completed" }],
      });
      yield* seedSession(sql, {
        threadId: "thread-starting",
        status: "starting",
        activeTurnId: "turn-finished",
      });

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-starting"));
      assert.strictEqual(result.resetSessions, 1);
    }),
  );

  it.effect("preserves an existing last_error on the session row when resetting", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-with-error",
        turnIds: [{ turnId: "turn-completed", state: "completed" }],
      });
      yield* seedSession(sql, {
        threadId: "thread-with-error",
        status: "running",
        activeTurnId: "turn-completed",
        lastError: "Original provider error",
      });

      yield* cleanup.cleanupThreadOrphans(asThreadId("thread-with-error"));

      const [session] = yield* fetchSession(sql, "thread-with-error");
      assert.ok(session);
      assert.strictEqual(session.last_error, "Original provider error");
    }),
  );

  it.effect("does NOT reset a session whose active_turn_id references a still-running turn", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-active",
        turnIds: [
          {
            turnId: "turn-in-flight",
            state: "running",
            startedAt: "2026-04-28T22:00:00.000Z",
            completedAt: null,
          },
        ],
      });
      yield* seedSession(sql, {
        threadId: "thread-active",
        status: "running",
        activeTurnId: "turn-in-flight",
      });

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-active"));

      assert.strictEqual(result.resetSessions, 0);
      const [session] = yield* fetchSession(sql, "thread-active");
      assert.ok(session);
      assert.strictEqual(session.status, "running");
      assert.strictEqual(session.active_turn_id, "turn-in-flight");
    }),
  );

  it.effect("does NOT reset a session whose active_turn_id references a pending turn", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-pending",
        turnIds: [
          {
            turnId: "turn-pending",
            state: "pending",
            startedAt: null,
            completedAt: null,
          },
        ],
      });
      yield* seedSession(sql, {
        threadId: "thread-pending",
        status: "running",
        activeTurnId: "turn-pending",
      });

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-pending"));

      assert.strictEqual(result.resetSessions, 0);
    }),
  );

  it.effect("does NOT reset a session whose status is 'ready' / 'idle' / 'stopped'", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      for (const status of ["ready", "idle", "stopped", "interrupted", "error"] as const) {
        yield* resetAllTables(sql);
        yield* seedThread(sql, {
          threadId: `thread-${status}`,
          turnIds: [{ turnId: "turn-completed", state: "completed" }],
        });
        yield* seedSession(sql, {
          threadId: `thread-${status}`,
          status,
          activeTurnId: "turn-completed",
        });

        const result = yield* cleanup.cleanupThreadOrphans(asThreadId(`thread-${status}`));
        assert.strictEqual(
          result.resetSessions,
          0,
          `should not reset sessions whose status is '${status}'`,
        );
      }
    }),
  );

  it.effect("does NOT touch sessions for other threads", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-target",
        turnIds: [{ turnId: "turn-done", state: "completed" }],
      });
      yield* seedSession(sql, {
        threadId: "thread-target",
        status: "running",
        activeTurnId: "turn-done",
      });
      yield* seedThread(sql, {
        threadId: "thread-other",
        turnIds: [{ turnId: "turn-other-done", state: "completed" }],
      });
      yield* seedSession(sql, {
        threadId: "thread-other",
        status: "running",
        activeTurnId: "turn-other-done",
        updatedAt: "2026-04-28T22:00:00.000Z",
      });

      yield* cleanup.cleanupThreadOrphans(asThreadId("thread-target"));

      const [otherSession] = yield* fetchSession(sql, "thread-other");
      assert.ok(otherSession);
      assert.strictEqual(otherSession.status, "running");
      assert.strictEqual(otherSession.active_turn_id, "turn-other-done");
      assert.strictEqual(otherSession.updated_at, "2026-04-28T22:00:00.000Z");
    }),
  );

  it.effect("marks a stuck running turn as interrupted when a newer turn has settled", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-stuck-turn",
        turnIds: [
          {
            turnId: "turn-stuck",
            state: "running",
            requestedAt: "2026-04-28T15:00:00.000Z",
            startedAt: "2026-04-28T15:00:00.000Z",
            completedAt: null,
          },
          {
            turnId: "turn-newer",
            state: "completed",
            requestedAt: "2026-04-28T16:00:00.000Z",
            completedAt: "2026-04-28T16:01:00.000Z",
          },
        ],
      });

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-stuck-turn"));

      assert.strictEqual(result.resetTurns, 1);

      const turns = yield* fetchTurns(sql, "thread-stuck-turn");
      const stuck = turns.find((row) => row.turn_id === "turn-stuck");
      const newer = turns.find((row) => row.turn_id === "turn-newer");
      assert.ok(stuck);
      assert.strictEqual(stuck.state, "interrupted");
      assert.ok(stuck.completed_at !== null, "completed_at should be filled");
      assert.ok(newer);
      assert.strictEqual(newer.state, "completed");
    }),
  );

  it.effect("does NOT interrupt a running turn when no newer turn has settled", () =>
    Effect.gen(function* () {
      const cleanup = yield* OrchestrationThreadCleanup;
      const sql = yield* SqlClient.SqlClient;

      yield* resetAllTables(sql);
      yield* seedThread(sql, {
        threadId: "thread-latest-running",
        turnIds: [
          {
            turnId: "turn-older-completed",
            state: "completed",
            requestedAt: "2026-04-28T14:00:00.000Z",
            completedAt: "2026-04-28T14:01:00.000Z",
          },
          {
            turnId: "turn-latest-running",
            state: "running",
            requestedAt: "2026-04-28T15:00:00.000Z",
            startedAt: "2026-04-28T15:00:00.000Z",
            completedAt: null,
          },
        ],
      });

      const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-latest-running"));

      assert.strictEqual(result.resetTurns, 0);
      const turns = yield* fetchTurns(sql, "thread-latest-running");
      const latest = turns.find((row) => row.turn_id === "turn-latest-running");
      assert.ok(latest);
      assert.strictEqual(latest.state, "running");
      assert.strictEqual(latest.completed_at, null);
    }),
  );

  it.effect(
    "session reset sees the just-interrupted turn as terminal in the same transaction",
    () =>
      Effect.gen(function* () {
        const cleanup = yield* OrchestrationThreadCleanup;
        const sql = yield* SqlClient.SqlClient;

        yield* resetAllTables(sql);
        yield* seedThread(sql, {
          threadId: "thread-cascade",
          turnIds: [
            {
              turnId: "turn-old-running",
              state: "running",
              requestedAt: "2026-04-28T14:00:00.000Z",
              startedAt: "2026-04-28T14:00:00.000Z",
              completedAt: null,
            },
            {
              turnId: "turn-newer-completed",
              state: "completed",
              requestedAt: "2026-04-28T15:00:00.000Z",
              completedAt: "2026-04-28T15:01:00.000Z",
            },
          ],
        });
        // Session is "running" pointed at the older turn, which we expect to
        // be flipped to interrupted FIRST in the transaction. The session
        // reset's predicate must see the just-flipped state.
        yield* seedSession(sql, {
          threadId: "thread-cascade",
          status: "running",
          activeTurnId: "turn-old-running",
        });

        const result = yield* cleanup.cleanupThreadOrphans(asThreadId("thread-cascade"));

        assert.strictEqual(result.resetTurns, 1);
        assert.strictEqual(result.resetSessions, 1);

        const [session] = yield* fetchSession(sql, "thread-cascade");
        assert.ok(session);
        assert.strictEqual(session.status, "stopped");
        assert.strictEqual(session.active_turn_id, null);
      }),
  );
});
