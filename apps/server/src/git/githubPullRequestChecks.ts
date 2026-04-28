/**
 * Decoder for `gh pr checks <n> --json name,status,conclusion,workflow,detailsUrl,bucket`.
 *
 * Includes `extractWorkflowRunId(detailsUrl)` which parses the GitHub Actions
 * URL `…/actions/runs/<runId>[/job/<jobId>]` so the UI can wire per-check
 * "Rerun" actions to `gh run rerun --job <jobId>` or `gh run rerun <runId>`
 * without an extra API round-trip.
 *
 * @module githubPullRequestChecks
 */
import { Cause, Exit, Result, Schema } from "effect";
import type {
  GitPrCheckBucket,
  GitPrCheckConclusion,
  GitPrCheckStatus,
  GitPullRequestCheck,
} from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

const RawCheckSchema = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  workflow: Schema.optional(Schema.NullOr(Schema.String)),
  detailsUrl: Schema.optional(Schema.NullOr(Schema.String)),
  bucket: Schema.optional(Schema.NullOr(Schema.String)),
});

const VALID_STATUS = new Set<GitPrCheckStatus>([
  "QUEUED",
  "IN_PROGRESS",
  "COMPLETED",
  "WAITING",
  "PENDING",
  "REQUESTED",
]);

const VALID_CONCLUSION = new Set<NonNullable<GitPrCheckConclusion>>([
  "SUCCESS",
  "FAILURE",
  "NEUTRAL",
  "CANCELLED",
  "SKIPPED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STALE",
]);

const VALID_BUCKET = new Set<GitPrCheckBucket>(["pass", "fail", "pending", "skipping", "cancel"]);

function trimOrEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function nullIfEmpty(value: string): string | null {
  return value.length > 0 ? value : null;
}

function normalizeStatus(value: string | null | undefined): GitPrCheckStatus {
  const upper = trimOrEmpty(value).toUpperCase().replaceAll("-", "_") as GitPrCheckStatus;
  if (VALID_STATUS.has(upper)) {
    return upper;
  }
  return "PENDING";
}

function normalizeConclusion(value: string | null | undefined): GitPrCheckConclusion {
  const upper = trimOrEmpty(value).toUpperCase().replaceAll("-", "_");
  if (upper.length === 0) return null;
  if (VALID_CONCLUSION.has(upper as NonNullable<GitPrCheckConclusion>)) {
    return upper as NonNullable<GitPrCheckConclusion>;
  }
  return null;
}

function normalizeBucket(
  value: string | null | undefined,
  conclusion: GitPrCheckConclusion,
  status: GitPrCheckStatus,
): GitPrCheckBucket {
  const lower = trimOrEmpty(value).toLowerCase() as GitPrCheckBucket;
  if (VALID_BUCKET.has(lower)) {
    return lower;
  }
  // Derive bucket from status/conclusion when omitted by gh.
  if (status !== "COMPLETED") return "pending";
  if (conclusion === "SUCCESS" || conclusion === "NEUTRAL") return "pass";
  if (conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "ACTION_REQUIRED") {
    return "fail";
  }
  if (conclusion === "CANCELLED") return "cancel";
  if (conclusion === "SKIPPED" || conclusion === "STALE") return "skipping";
  return "pending";
}

/**
 * Parse `https://github.com/<owner>/<repo>/actions/runs/<runId>[/job/<jobId>]`
 * (with or without trailing path segments) and return `{ workflowRunId, jobId }`.
 *
 * Returns `{ workflowRunId: null, jobId: null }` when the URL doesn't match.
 */
export function extractWorkflowRunId(detailsUrl: string | null | undefined): {
  workflowRunId: string | null;
  jobId: string | null;
} {
  const url = trimOrEmpty(detailsUrl);
  if (url.length === 0) {
    return { workflowRunId: null, jobId: null };
  }
  const match = /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/i.exec(url);
  if (!match) {
    return { workflowRunId: null, jobId: null };
  }
  return {
    workflowRunId: match[1] ?? null,
    jobId: match[2] ?? null,
  };
}

function normalize(raw: Schema.Schema.Type<typeof RawCheckSchema>): GitPullRequestCheck | null {
  const name = trimOrEmpty(raw.name);
  if (name.length === 0) {
    return null;
  }
  const status = normalizeStatus(raw.status);
  const conclusion = normalizeConclusion(raw.conclusion);
  const bucket = normalizeBucket(raw.bucket, conclusion, status);
  const detailsUrl = nullIfEmpty(trimOrEmpty(raw.detailsUrl));
  const { workflowRunId, jobId } = extractWorkflowRunId(detailsUrl);
  return {
    name,
    status,
    conclusion,
    workflow: nullIfEmpty(trimOrEmpty(raw.workflow)),
    detailsUrl,
    workflowRunId,
    jobId,
    bucket,
  };
}

const decodeCheckList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeCheckEntry = Schema.decodeUnknownExit(RawCheckSchema);

export const formatGitHubPullRequestChecksDecodeError = formatSchemaError;

export function decodeGitHubPullRequestChecksJson(
  raw: string,
): Result.Result<ReadonlyArray<GitPullRequestCheck>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeCheckList(raw);
  if (!Result.isSuccess(result)) {
    return Result.fail(result.failure);
  }
  const checks: GitPullRequestCheck[] = [];
  for (const entry of result.success) {
    const decoded = decodeCheckEntry(entry);
    if (Exit.isFailure(decoded)) continue;
    const normalized = normalize(decoded.value);
    if (normalized !== null) {
      checks.push(normalized);
    }
  }
  return Result.succeed(checks);
}
