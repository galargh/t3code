import { Effect, Layer, Result, Schema, SchemaIssue } from "effect";
import { TrimmedNonEmptyString } from "@t3tools/contracts";

import { runProcess } from "../../processRunner.ts";
import { GitHubCliError } from "@t3tools/contracts";
import {
  GitHubCli,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
} from "../Services/GitHubCli.ts";
import {
  decodeGitHubPullRequestJson,
  decodeGitHubPullRequestListJson,
  formatGitHubJsonDecodeError,
} from "../githubPullRequests.ts";
import {
  decodeGitHubPullRequestChecksJson,
  formatGitHubPullRequestChecksDecodeError,
} from "../githubPullRequestChecks.ts";
import {
  decodeGitHubPullRequestCommentsJson,
  formatGitHubPullRequestCommentsDecodeError,
} from "../githubPullRequestComments.ts";
import {
  decodeGitHubPullRequestDetailJson,
  formatGitHubPullRequestDetailDecodeError,
} from "../githubPullRequestDetail.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

type GitHubCliOperation =
  | "execute"
  | "stdout"
  | "getPullRequestDetail"
  | "getPullRequestChecks"
  | "getPullRequestComments"
  | "mergePullRequest"
  | "rerunWorkflowRun"
  | "updatePullRequestBranch";

function normalizeGitHubCliError(operation: GitHubCliOperation, error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token")
    ) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        cause: error,
      });
    }

    if (
      lower.includes("could not resolve to a pullrequest") ||
      lower.includes("repository.pullrequest") ||
      lower.includes("no pull requests found for branch") ||
      lower.includes("pull request not found")
    ) {
      return new GitHubCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        cause: error,
      });
    }

    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: "GitHub CLI command failed.",
    cause: error,
  });
}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation:
    | GitHubCliOperation
    | "listOpenPullRequests"
    | "getPullRequest"
    | "getRepositoryCloneUrls",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

const makeGitHubCli = Effect.sync(() => {
  const execute: GitHubCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });

  const service = {
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "listOpenPullRequests",
                        detail: `GitHub CLI returned invalid PR list JSON: ${formatGitHubJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequest",
                    detail: `GitHub CLI returned invalid pull request JSON: ${formatGitHubJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    getPullRequestDetail: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          String(input.prNumber),
          "--json",
          "number,url,title,body,state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefName,author,reviewDecision",
        ],
      }).pipe(
        Effect.mapError((error) => {
          if (error.operation === "execute" || error.operation === "stdout") {
            return new GitHubCliError({
              operation: "getPullRequestDetail",
              detail: error.detail,
              ...(error.cause !== undefined ? { cause: error.cause } : {}),
            });
          }
          return error;
        }),
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestDetailJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequestDetail",
                    detail: `GitHub CLI returned invalid pull request detail JSON: ${formatGitHubPullRequestDetailDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }
              return Effect.succeed(decoded.success);
            }),
          ),
        ),
      ),
    getPullRequestChecks: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "checks",
          String(input.prNumber),
          "--json",
          "name,status,conclusion,workflow,detailsUrl,bucket",
        ],
      }).pipe(
        Effect.mapError((error) => {
          if (error.operation === "execute" || error.operation === "stdout") {
            return new GitHubCliError({
              operation: "getPullRequestChecks",
              detail: error.detail,
              ...(error.cause !== undefined ? { cause: error.cause } : {}),
            });
          }
          return error;
        }),
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeGitHubPullRequestChecksJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "getPullRequestChecks",
                        detail: `GitHub CLI returned invalid PR checks JSON: ${formatGitHubPullRequestChecksDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }
                  return Effect.succeed(decoded.success);
                }),
              ),
        ),
      ),
    getPullRequestComments: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          String(input.prNumber),
          "--comments",
          "--json",
          "comments,reviews,reviewThreads",
        ],
      }).pipe(
        Effect.mapError((error) => {
          if (error.operation === "execute" || error.operation === "stdout") {
            return new GitHubCliError({
              operation: "getPullRequestComments",
              detail: error.detail,
              ...(error.cause !== undefined ? { cause: error.cause } : {}),
            });
          }
          return error;
        }),
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeGitHubPullRequestCommentsJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "getPullRequestComments",
                        detail: `GitHub CLI returned invalid PR comments JSON: ${formatGitHubPullRequestCommentsDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }
                  return Effect.succeed(decoded.success);
                }),
              ),
        ),
      ),
    mergePullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "merge",
          String(input.prNumber),
          `--${input.method}`,
          ...(input.auto ? ["--auto"] : []),
          ...(input.deleteBranch ? ["--delete-branch"] : []),
        ],
      }).pipe(
        Effect.mapError((error) => {
          if (error.operation === "execute" || error.operation === "stdout") {
            return new GitHubCliError({
              operation: "mergePullRequest",
              detail: error.detail,
              ...(error.cause !== undefined ? { cause: error.cause } : {}),
            });
          }
          return error;
        }),
        Effect.map((result) => {
          const stderrLower = result.stderr.toLowerCase();
          const stdoutLower = result.stdout.toLowerCase();
          const queued =
            input.auto === true ||
            stderrLower.includes("auto-merge") ||
            stdoutLower.includes("auto-merge") ||
            stderrLower.includes("merge queue") ||
            stdoutLower.includes("merge queue");
          return { status: queued ? ("queued" as const) : ("merged" as const) };
        }),
      ),
    rerunWorkflowRun: (input) => {
      const args =
        input.mode === "job"
          ? input.jobId
            ? ["run", "rerun", "--job", input.jobId]
            : null
          : input.mode === "failed"
            ? input.workflowRunId
              ? ["run", "rerun", input.workflowRunId, "--failed"]
              : null
            : input.workflowRunId
              ? ["run", "rerun", input.workflowRunId]
              : null;
      if (args === null) {
        return Effect.fail(
          new GitHubCliError({
            operation: "rerunWorkflowRun",
            detail: "Missing required workflowRunId / jobId for rerun.",
          }),
        );
      }
      return execute({ cwd: input.cwd, args }).pipe(
        Effect.mapError((error) => {
          if (error.operation === "execute" || error.operation === "stdout") {
            return new GitHubCliError({
              operation: "rerunWorkflowRun",
              detail: error.detail,
              ...(error.cause !== undefined ? { cause: error.cause } : {}),
            });
          }
          return error;
        }),
        Effect.asVoid,
      );
    },
    updatePullRequestBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "update-branch", String(input.prNumber)],
      }).pipe(
        Effect.mapError((error) => {
          if (error.operation === "execute" || error.operation === "stdout") {
            return new GitHubCliError({
              operation: "updatePullRequestBranch",
              detail: error.detail,
              ...(error.cause !== undefined ? { cause: error.cause } : {}),
            });
          }
          return error;
        }),
        Effect.asVoid,
      ),
  } satisfies GitHubCliShape;

  return service;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
