/**
 * Decoder for `gh pr view <n> --comments --json comments,reviews,reviewThreads`.
 *
 * Flattens the three sources gh exposes (issue comments, top-level reviews,
 * and review threads) into a single chronologically-sorted
 * `GitPullRequestComment[]` keyed by id, with file/line metadata preserved
 * for review-thread comments.
 *
 * @module githubPullRequestComments
 */
import { Cause, Result, Schema } from "effect";
import type { GitPrCommentKind, GitPullRequestComment } from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

const RawAuthorSchema = Schema.optional(
  Schema.NullOr(
    Schema.Struct({
      login: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
);

const RawIssueCommentSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  author: RawAuthorSchema,
});

const RawReviewSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  submittedAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  author: RawAuthorSchema,
});

const RawReviewThreadCommentSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  originalLine: Schema.optional(Schema.NullOr(Schema.Number)),
  inReplyTo: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
      }),
    ),
  ),
  author: RawAuthorSchema,
});

const RawReviewThreadSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  isResolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  comments: Schema.optional(Schema.NullOr(Schema.Array(RawReviewThreadCommentSchema))),
  // Some `gh` versions wrap comments in `{ nodes: [] }`.
  // Accept both shapes by also reading raw arrays under `nodes`.
});

const RawWrapperSchema = Schema.Struct({
  comments: Schema.optional(Schema.NullOr(Schema.Array(RawIssueCommentSchema))),
  reviews: Schema.optional(Schema.NullOr(Schema.Array(RawReviewSchema))),
  reviewThreads: Schema.optional(Schema.NullOr(Schema.Array(RawReviewThreadSchema))),
});

function trimOrEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function nullIfEmpty(value: string): string | null {
  return value.length > 0 ? value : null;
}

function asString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function authorLogin(author: { login?: string | null | undefined } | null | undefined): string {
  const login = trimOrEmpty(author?.login);
  return login.length > 0 ? login : "ghost";
}

function makeIssueComment(
  raw: Schema.Schema.Type<typeof RawIssueCommentSchema>,
  fallbackIndex: number,
): GitPullRequestComment | null {
  const body = raw.body ?? "";
  const id = asString(raw.id ?? null);
  const resolvedId = id.length > 0 ? `issue:${id}` : `issue:${fallbackIndex}`;
  const createdAt = trimOrEmpty(raw.createdAt);
  if (body.trim().length === 0) {
    return null;
  }
  return {
    id: resolvedId,
    kind: "issue" satisfies GitPrCommentKind,
    author: authorLogin(raw.author),
    body,
    createdAt,
    url: nullIfEmpty(trimOrEmpty(raw.url)),
    filePath: null,
    line: null,
    threadId: null,
    isResolved: null,
    inReplyToId: null,
  };
}

function makeReviewComment(
  raw: Schema.Schema.Type<typeof RawReviewSchema>,
  fallbackIndex: number,
): GitPullRequestComment | null {
  const body = raw.body ?? "";
  const id = asString(raw.id ?? null);
  const resolvedId = id.length > 0 ? `review:${id}` : `review:${fallbackIndex}`;
  const createdAt = trimOrEmpty(raw.submittedAt) || trimOrEmpty(raw.createdAt);
  // gh emits "" body when reviewer just clicks Approve without a comment;
  // skip those — they are noise in the panel.
  if (body.trim().length === 0) {
    return null;
  }
  return {
    id: resolvedId,
    kind: "review" satisfies GitPrCommentKind,
    author: authorLogin(raw.author),
    body,
    createdAt,
    url: nullIfEmpty(trimOrEmpty(raw.url)),
    filePath: null,
    line: null,
    threadId: null,
    isResolved: null,
    inReplyToId: null,
  };
}

function makeReviewThreadComment(
  raw: Schema.Schema.Type<typeof RawReviewThreadCommentSchema>,
  threadId: string,
  isResolved: boolean | null,
  fallbackIndex: number,
): GitPullRequestComment | null {
  const body = raw.body ?? "";
  if (body.trim().length === 0) {
    return null;
  }
  const id = asString(raw.id ?? null);
  const resolvedId =
    id.length > 0 ? `thread:${threadId}:${id}` : `thread:${threadId}:${fallbackIndex}`;
  const filePath = nullIfEmpty(trimOrEmpty(raw.path));
  const lineNumber = raw.line ?? raw.originalLine ?? null;
  const line = typeof lineNumber === "number" && lineNumber > 0 ? Math.floor(lineNumber) : null;
  const inReplyToId = asString(raw.inReplyTo?.id ?? null);
  return {
    id: resolvedId,
    kind: "review_thread" satisfies GitPrCommentKind,
    author: authorLogin(raw.author),
    body,
    createdAt: trimOrEmpty(raw.createdAt),
    url: nullIfEmpty(trimOrEmpty(raw.url)),
    filePath,
    line,
    threadId,
    isResolved,
    inReplyToId: inReplyToId.length > 0 ? `thread:${threadId}:${inReplyToId}` : null,
  };
}

function compareByCreatedAt(left: GitPullRequestComment, right: GitPullRequestComment): number {
  const leftTs = Date.parse(left.createdAt);
  const rightTs = Date.parse(right.createdAt);
  const safeLeft = Number.isNaN(leftTs) ? 0 : leftTs;
  const safeRight = Number.isNaN(rightTs) ? 0 : rightTs;
  return safeLeft - safeRight;
}

function flatten(raw: Schema.Schema.Type<typeof RawWrapperSchema>): GitPullRequestComment[] {
  const out: GitPullRequestComment[] = [];
  const issues = raw.comments ?? [];
  for (let index = 0; index < issues.length; index += 1) {
    const entry = issues[index];
    if (!entry) continue;
    const comment = makeIssueComment(entry, index);
    if (comment) out.push(comment);
  }
  const reviews = raw.reviews ?? [];
  for (let index = 0; index < reviews.length; index += 1) {
    const entry = reviews[index];
    if (!entry) continue;
    const comment = makeReviewComment(entry, index);
    if (comment) out.push(comment);
  }
  const threads = raw.reviewThreads ?? [];
  for (let threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
    const thread = threads[threadIndex];
    if (!thread) continue;
    const threadId = asString(thread.id ?? null) || `t${threadIndex}`;
    const isResolved = thread.isResolved ?? null;
    const comments = thread.comments ?? [];
    for (let commentIndex = 0; commentIndex < comments.length; commentIndex += 1) {
      const entry = comments[commentIndex];
      if (!entry) continue;
      const comment = makeReviewThreadComment(entry, threadId, isResolved, commentIndex);
      if (comment) out.push(comment);
    }
  }
  return out.toSorted(compareByCreatedAt);
}

const decodeWrapper = decodeJsonResult(RawWrapperSchema);

export const formatGitHubPullRequestCommentsDecodeError = formatSchemaError;

export function decodeGitHubPullRequestCommentsJson(
  raw: string,
): Result.Result<ReadonlyArray<GitPullRequestComment>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeWrapper(raw);
  if (!Result.isSuccess(result)) {
    return Result.fail(result.failure);
  }
  return Result.succeed(flatten(result.success));
}
