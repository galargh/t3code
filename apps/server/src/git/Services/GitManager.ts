/**
 * GitManager - Effect service contract for stacked Git workflows.
 *
 * Orchestrates status inspection and commit/push/PR flows by composing
 * lower-level Git and external tool services.
 *
 * @module GitManager
 */
import {
  GitActionProgressEvent,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestChecksResult,
  GitPullRequestCommentsResult,
  GitPullRequestDetailResult,
  GitPullRequestForCwdInput,
  GitPullRequestMergeInput,
  GitPullRequestMergeResult,
  GitPullRequestRefInput,
  GitPullRequestRerunChecksInput,
  GitPullRequestRerunChecksResult,
  GitPullRequestUpdateBranchInput,
  GitPullRequestUpdateBranchResult,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusInput,
  GitStatusResult,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";
import type { GitManagerServiceError } from "@t3tools/contracts";

export interface GitActionProgressReporter {
  readonly publish: (event: GitActionProgressEvent) => Effect.Effect<void, never>;
}

export interface GitRunStackedActionOptions {
  readonly actionId?: string;
  readonly progressReporter?: GitActionProgressReporter;
}

/**
 * GitManagerShape - Service API for high-level Git workflow actions.
 */
export interface GitManagerShape {
  /**
   * Read current repository Git status plus open PR metadata when available.
   */
  readonly status: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;

  /**
   * Read local repository status without remote hosting enrichment.
   */
  readonly localStatus: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusLocalResult, GitManagerServiceError>;

  /**
   * Read remote tracking / PR status for a repository.
   */
  readonly remoteStatus: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusRemoteResult | null, GitManagerServiceError>;

  /**
   * Clear any cached local status snapshot for a repository.
   */
  readonly invalidateLocalStatus: (cwd: string) => Effect.Effect<void, never>;

  /**
   * Clear any cached remote status snapshot for a repository.
   */
  readonly invalidateRemoteStatus: (cwd: string) => Effect.Effect<void, never>;

  /**
   * Clear any cached status snapshot for a repository so the next read is fresh.
   */
  readonly invalidateStatus: (cwd: string) => Effect.Effect<void, never>;

  /**
   * Resolve a pull request by URL/number against the current repository.
   */
  readonly resolvePullRequest: (
    input: GitPullRequestRefInput,
  ) => Effect.Effect<GitResolvePullRequestResult, GitManagerServiceError>;

  /**
   * Prepare a new thread workspace from a pull request in local or worktree mode.
   */
  readonly preparePullRequestThread: (
    input: GitPreparePullRequestThreadInput,
  ) => Effect.Effect<GitPreparePullRequestThreadResult, GitManagerServiceError>;

  /**
   * Run a Git action (`commit`, `push`, `create_pr`, `create_draft_pr`, `commit_push`, `commit_push_pr`, `commit_push_draft_pr`).
   * When `featureBranch` is set, creates and checks out a feature branch first.
   */
  readonly runStackedAction: (
    input: GitRunStackedActionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>;

  /**
   * Fetch full PR detail (title, body, draft, mergeable, mergeStateStatus, …).
   */
  readonly getPullRequestDetail: (
    input: GitPullRequestForCwdInput,
  ) => Effect.Effect<GitPullRequestDetailResult, GitManagerServiceError>;

  /**
   * Fetch a PR's check-runs list.
   */
  readonly getPullRequestChecks: (
    input: GitPullRequestForCwdInput,
  ) => Effect.Effect<GitPullRequestChecksResult, GitManagerServiceError>;

  /**
   * Fetch and flatten a PR's comments.
   */
  readonly getPullRequestComments: (
    input: GitPullRequestForCwdInput,
  ) => Effect.Effect<GitPullRequestCommentsResult, GitManagerServiceError>;

  /**
   * Merge / squash / rebase a PR (optionally as auto-merge).
   * After completing, invalidates cached git status snapshots so subsequent
   * status reads observe the new PR/branch state.
   */
  readonly mergePullRequest: (
    input: GitPullRequestMergeInput,
  ) => Effect.Effect<GitPullRequestMergeResult, GitManagerServiceError>;

  /**
   * Rerun a workflow run / its failed jobs / a single job for a PR's checks.
   */
  readonly rerunPullRequestChecks: (
    input: GitPullRequestRerunChecksInput,
  ) => Effect.Effect<GitPullRequestRerunChecksResult, GitManagerServiceError>;

  /**
   * Update a PR's branch with the latest base ref, then invalidate status cache.
   */
  readonly updatePullRequestBranch: (
    input: GitPullRequestUpdateBranchInput,
  ) => Effect.Effect<GitPullRequestUpdateBranchResult, GitManagerServiceError>;
}

/**
 * GitManager - Service tag for stacked Git workflow orchestration.
 */
export class GitManager extends Context.Service<GitManager, GitManagerShape>()(
  "t3/git/Services/GitManager",
) {}
