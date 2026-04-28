import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { GitHubCliLive } from "./GitHubCli.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(GitHubCliLive);

afterEach(() => {
  mockedRunProcess.mockReset();
});

layer("GitHubCliLive", (it) => {
  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 42,
          title: "Add PR thread creation",
          url: "https://github.com/pingdotgg/codething-mvp/pull/42",
          baseRefName: "main",
          headRefName: "feature/pr-threads",
          state: "OPEN",
          mergedAt: null,
          isCrossRepository: true,
          headRepository: {
            nameWithOwner: "octocat/codething-mvp",
          },
          headRepositoryOwner: {
            login: "octocat",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "#42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("trims pull request fields decoded from gh json", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 42,
          title: "  Add PR thread creation  \n",
          url: " https://github.com/pingdotgg/codething-mvp/pull/42 ",
          baseRefName: " main ",
          headRefName: "\tfeature/pr-threads\t",
          state: "OPEN",
          mergedAt: null,
          isCrossRepository: true,
          headRepository: {
            nameWithOwner: " octocat/codething-mvp ",
          },
          headRepositoryOwner: {
            login: " octocat ",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "#42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
    }),
  );

  it.effect("skips invalid entries when parsing pr lists", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 0,
            title: "invalid",
            url: "https://github.com/pingdotgg/codething-mvp/pull/0",
            baseRefName: "main",
            headRefName: "feature/invalid",
          },
          {
            number: 43,
            title: "  Valid PR  ",
            url: " https://github.com/pingdotgg/codething-mvp/pull/43 ",
            baseRefName: " main ",
            headRefName: " feature/pr-list ",
            headRepository: {
              nameWithOwner: "   ",
            },
            headRepositoryOwner: {
              login: "   ",
            },
          },
        ]),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.listOpenPullRequests({
          cwd: "/repo",
          headSelector: "feature/pr-list",
        });
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/43",
          baseRefName: "main",
          headRefName: "feature/pr-list",
          state: "open",
        },
      ]);
    }),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          nameWithOwner: "octocat/codething-mvp",
          url: "https://github.com/octocat/codething-mvp",
          sshUrl: "git@github.com:octocat/codething-mvp.git",
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "octocat/codething-mvp",
        });
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockRejectedValueOnce(
        new Error(
          "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
        ),
      );

      const error = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
    }),
  );

  it.effect("getPullRequestDetail decodes detail JSON", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 7,
          url: "https://github.com/o/r/pull/7",
          title: "Add thing",
          body: "Body",
          state: "OPEN",
          isDraft: false,
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          baseRefName: "main",
          headRefName: "feature/x",
          author: { login: "alice", name: "Alice" },
          reviewDecision: "APPROVED",
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequestDetail({ cwd: "/repo", prNumber: 7 });
      });

      expect(result.number).toBe(7);
      expect(result.mergeStateStatus).toBe("CLEAN");
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "pr",
          "view",
          "7",
          "--json",
          "number,url,title,body,state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefName,author,reviewDecision",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("getPullRequestChecks decodes checks JSON and derives runId", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            name: "test",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            workflow: "CI",
            detailsUrl: "https://github.com/o/r/actions/runs/100/job/200",
            bucket: "pass",
          },
        ]),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequestChecks({ cwd: "/repo", prNumber: 7 });
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.workflowRunId).toBe("100");
      expect(result[0]?.jobId).toBe("200");
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        ["pr", "checks", "7", "--json", "name,status,conclusion,workflow,detailsUrl,bucket"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("getPullRequestComments flattens reviews and threads", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          comments: [
            {
              id: 1,
              body: "issue body",
              createdAt: "2025-01-02T00:00:00Z",
              author: { login: "alice" },
            },
          ],
          reviews: [],
          reviewThreads: [
            {
              id: "T1",
              isResolved: false,
              comments: [
                {
                  id: 2,
                  body: "review body",
                  createdAt: "2025-01-01T00:00:00Z",
                  path: "src/foo.ts",
                  line: 10,
                  author: { login: "bob" },
                },
              ],
            },
          ],
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequestComments({ cwd: "/repo", prNumber: 7 });
      });

      expect(result.map((c) => c.id)).toEqual(["thread:T1:2", "issue:1"]);
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        ["pr", "view", "7", "--comments", "--json", "comments,reviews,reviewThreads"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("mergePullRequest reports queued status when --auto is set", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: "",
        stderr: "Auto-merge enabled",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.mergePullRequest({
          cwd: "/repo",
          prNumber: 7,
          method: "squash",
          auto: true,
          deleteBranch: true,
        });
      });

      expect(result.status).toBe("queued");
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        ["pr", "merge", "7", "--squash", "--auto", "--delete-branch"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("mergePullRequest reports merged status for immediate merge", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: "Merged",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.mergePullRequest({
          cwd: "/repo",
          prNumber: 7,
          method: "merge",
        });
      });

      expect(result.status).toBe("merged");
    }),
  );

  it.effect("rerunWorkflowRun supports failed and job modes", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      mockedRunProcess.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        yield* gh.rerunWorkflowRun({ cwd: "/repo", mode: "failed", workflowRunId: "100" });
        yield* gh.rerunWorkflowRun({ cwd: "/repo", mode: "job", jobId: "200" });
      });

      expect(mockedRunProcess).toHaveBeenNthCalledWith(
        1,
        "gh",
        ["run", "rerun", "100", "--failed"],
        expect.objectContaining({ cwd: "/repo" }),
      );
      expect(mockedRunProcess).toHaveBeenNthCalledWith(
        2,
        "gh",
        ["run", "rerun", "--job", "200"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("updatePullRequestBranch invokes gh pr update-branch", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        yield* gh.updatePullRequestBranch({ cwd: "/repo", prNumber: 7 });
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        ["pr", "update-branch", "7"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );
});
