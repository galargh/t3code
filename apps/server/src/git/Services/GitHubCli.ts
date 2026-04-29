/**
 * GitHubCli - Effect service contract for `gh` process interactions.
 *
 * Provides thin command execution helpers used by Git workflow orchestration.
 *
 * @module GitHubCli
 */
import { Context } from "effect";
import type { Effect } from "effect";

import type { ProcessRunResult } from "../../processRunner.ts";
import type {
  GitHubCliError,
  GitPullRequestCheck,
  GitPullRequestComment,
  GitPullRequestDetail,
} from "@t3tools/contracts";

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "queued" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

/**
 * GitHubCliShape - Service API for executing GitHub CLI commands.
 */
export interface GitHubCliShape {
  /**
   * Execute a GitHub CLI command and return full process output.
   */
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, GitHubCliError>;

  /**
   * List open pull requests for a head branch.
   */
  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  /**
   * Resolve a pull request by URL, number, or branch-ish identifier.
   */
  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  /**
   * Resolve clone URLs for a GitHub repository.
   */
  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  /**
   * Create a pull request from branch context and body file.
   */
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
    readonly draft?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Resolve repository default branch through GitHub metadata.
   */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  /**
   * Checkout a pull request into the current repository worktree.
   */
  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Fetch full PR detail (title, body, draft, mergeable, mergeStateStatus, …).
   */
  readonly getPullRequestDetail: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<GitPullRequestDetail, GitHubCliError>;

  /**
   * Fetch the check-runs list for a PR.
   */
  readonly getPullRequestChecks: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<ReadonlyArray<GitPullRequestCheck>, GitHubCliError>;

  /**
   * Fetch and flatten a PR's issue comments + reviews + review-thread comments.
   */
  readonly getPullRequestComments: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<ReadonlyArray<GitPullRequestComment>, GitHubCliError>;

  /**
   * Merge / squash / rebase a PR via `gh pr merge`. When `auto: true` is set
   * and the PR is not yet "CLEAN", returns `{ status: "queued" }` so callers
   * can present the right UX (auto-merge enabled vs immediate merge).
   */
  readonly mergePullRequest: (input: {
    readonly cwd: string;
    readonly prNumber: number;
    readonly method: "merge" | "squash" | "rebase";
    readonly auto?: boolean;
    readonly deleteBranch?: boolean;
  }) => Effect.Effect<{ readonly status: "merged" | "queued" }, GitHubCliError>;

  /**
   * Rerun a workflow run, all of its failed jobs, or a single job.
   */
  readonly rerunWorkflowRun: (input: {
    readonly cwd: string;
    readonly mode: "all" | "failed" | "job";
    readonly workflowRunId?: string;
    readonly jobId?: string;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Update the PR's branch with the latest base (merge or rebase as configured
   * in repo settings).
   */
  readonly updatePullRequestBranch: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Disable auto-merge on a PR (effectively "remove from queue"). Wraps
   * `gh pr merge <n> --disable-auto`. Caller is responsible for refreshing
   * status / detail caches.
   */
  readonly disablePullRequestAutoMerge: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<void, GitHubCliError>;
}

/**
 * GitHubCli - Service tag for GitHub CLI process execution.
 */
export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "t3/git/Services/GitHubCli",
) {}
