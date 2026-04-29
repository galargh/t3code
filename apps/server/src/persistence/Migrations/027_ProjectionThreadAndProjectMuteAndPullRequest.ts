import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Adds the PR snapshot columns to projection_threads and the muted_at columns
 * to both projection_threads and projection_projects.
 *
 * - PR columns are split (not a single JSON blob) so debugging queries like
 *   `WHERE pr_number IS NULL` are cheap, matching migration 023's pattern.
 * - All columns are nullable; the all-or-nothing convention for the PR
 *   snapshot is enforced by the row-mapping helper in `ProjectionSnapshotQuery`.
 * - `muted_at` is null by default — threads/projects start unmuted.
 * - No SQL backfill: the reactor populates `pr_*` lazily, and `muted_at`
 *   begins null because there's no historical mute state to recover.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_number INTEGER`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_title TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_url TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_state TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_base_branch TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_head_branch TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_branch TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE projection_threads ADD COLUMN pr_refreshed_at TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );

  yield* sql`ALTER TABLE projection_threads ADD COLUMN muted_at TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );

  yield* sql`ALTER TABLE projection_projects ADD COLUMN muted_at TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
});
