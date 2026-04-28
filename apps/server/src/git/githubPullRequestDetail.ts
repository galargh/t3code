/**
 * Decoder for `gh pr view <n> --json …` (full detail).
 *
 * Normalizes the raw JSON shape into our `GitPullRequestDetail` contract:
 * - state (open/closed/merged) is derived from the upstream `state` + `mergedAt`.
 * - mergeable / mergeStateStatus default to "UNKNOWN" when missing.
 * - reviewDecision is null when unset.
 *
 * @module githubPullRequestDetail
 */
import { Cause, Result, Schema } from "effect";
import type {
  GitPrMergeStateStatus,
  GitPrMergeable,
  GitPrReviewDecision,
  GitPullRequestDetail,
} from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

const RawAuthorSchema = Schema.NullOr(
  Schema.Struct({
    login: Schema.optional(Schema.NullOr(Schema.String)),
    name: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

const RawDetailSchema = Schema.Struct({
  number: Schema.Number,
  url: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isDraft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
  mergeStateStatus: Schema.optional(Schema.NullOr(Schema.String)),
  baseRefName: Schema.String,
  headRefName: Schema.String,
  author: Schema.optional(RawAuthorSchema),
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
});

const VALID_MERGE_STATE_STATUS: ReadonlySet<GitPrMergeStateStatus> = new Set<GitPrMergeStateStatus>(
  ["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"],
);

const VALID_MERGEABLE: ReadonlySet<GitPrMergeable> = new Set<GitPrMergeable>([
  "MERGEABLE",
  "CONFLICTING",
  "UNKNOWN",
]);

const VALID_REVIEW_DECISION = new Set<NonNullable<GitPrReviewDecision>>([
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED",
  "COMMENTED",
]);

function trimOrEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const state = trimOrEmpty(input.state).toUpperCase();
  if (state === "MERGED" || trimOrEmpty(input.mergedAt).length > 0) return "merged";
  if (state === "CLOSED") return "closed";
  return "open";
}

function normalizeMergeable(value: string | null | undefined): GitPrMergeable {
  const upper = trimOrEmpty(value).toUpperCase() as GitPrMergeable;
  return VALID_MERGEABLE.has(upper) ? upper : "UNKNOWN";
}

function normalizeMergeStateStatus(value: string | null | undefined): GitPrMergeStateStatus {
  const upper = trimOrEmpty(value).toUpperCase() as GitPrMergeStateStatus;
  return VALID_MERGE_STATE_STATUS.has(upper) ? upper : "UNKNOWN";
}

function normalizeReviewDecision(value: string | null | undefined): GitPrReviewDecision {
  const upper = trimOrEmpty(value).toUpperCase();
  if (upper.length === 0) return null;
  if (VALID_REVIEW_DECISION.has(upper as NonNullable<GitPrReviewDecision>)) {
    return upper as NonNullable<GitPrReviewDecision>;
  }
  return null;
}

function normalize(raw: Schema.Schema.Type<typeof RawDetailSchema>): GitPullRequestDetail {
  const login = trimOrEmpty(raw.author?.login);
  return {
    number: raw.number,
    url: trimOrEmpty(raw.url),
    title: raw.title.trim(),
    body: raw.body ?? "",
    state: normalizeState(raw),
    isDraft: Boolean(raw.isDraft),
    mergeable: normalizeMergeable(raw.mergeable),
    mergeStateStatus: normalizeMergeStateStatus(raw.mergeStateStatus),
    baseRefName: raw.baseRefName.trim(),
    headRefName: raw.headRefName.trim(),
    author: {
      login: login.length > 0 ? login : "ghost",
      name: trimOrEmpty(raw.author?.name).length > 0 ? raw.author!.name!.trim() : null,
    },
    reviewDecision: normalizeReviewDecision(raw.reviewDecision),
  };
}

const decodeRawDetail = decodeJsonResult(RawDetailSchema);

export const formatGitHubPullRequestDetailDecodeError = formatSchemaError;

export function decodeGitHubPullRequestDetailJson(
  raw: string,
): Result.Result<GitPullRequestDetail, Cause.Cause<Schema.SchemaError>> {
  const result = decodeRawDetail(raw);
  if (Result.isSuccess(result)) {
    return Result.succeed(normalize(result.success));
  }
  return Result.fail(result.failure);
}
