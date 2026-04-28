import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeGitHubPullRequestChecksJson,
  extractWorkflowRunId,
} from "./githubPullRequestChecks.ts";

describe("extractWorkflowRunId", () => {
  it("parses run + job id", () => {
    expect(extractWorkflowRunId("https://github.com/o/r/actions/runs/123/job/456")).toEqual({
      workflowRunId: "123",
      jobId: "456",
    });
  });

  it("parses run id without job", () => {
    expect(extractWorkflowRunId("https://github.com/o/r/actions/runs/789")).toEqual({
      workflowRunId: "789",
      jobId: null,
    });
  });

  it("returns nulls for malformed URLs", () => {
    expect(extractWorkflowRunId("not-a-url")).toEqual({
      workflowRunId: null,
      jobId: null,
    });
    expect(extractWorkflowRunId(null)).toEqual({ workflowRunId: null, jobId: null });
  });
});

describe("decodeGitHubPullRequestChecksJson", () => {
  it("decodes a mixed list and derives bucket / runId", () => {
    const raw = JSON.stringify([
      {
        name: "test",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        workflow: "CI",
        detailsUrl: "https://github.com/o/r/actions/runs/100/job/200",
        bucket: "pass",
      },
      {
        name: "lint",
        status: "completed",
        conclusion: "failure",
        workflow: "CI",
        detailsUrl: "https://github.com/o/r/actions/runs/100/job/201",
        // bucket missing — should be derived
      },
      {
        name: "matrix-build",
        status: "in_progress",
        conclusion: null,
        workflow: "CI",
        detailsUrl: "https://github.com/o/r/actions/runs/100",
      },
      // Empty-name entry should be dropped.
      { name: "  ", status: "QUEUED" },
    ]);

    const result = decodeGitHubPullRequestChecksJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toEqual([
      {
        name: "test",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        workflow: "CI",
        detailsUrl: "https://github.com/o/r/actions/runs/100/job/200",
        workflowRunId: "100",
        jobId: "200",
        bucket: "pass",
      },
      {
        name: "lint",
        status: "COMPLETED",
        conclusion: "FAILURE",
        workflow: "CI",
        detailsUrl: "https://github.com/o/r/actions/runs/100/job/201",
        workflowRunId: "100",
        jobId: "201",
        bucket: "fail",
      },
      {
        name: "matrix-build",
        status: "IN_PROGRESS",
        conclusion: null,
        workflow: "CI",
        detailsUrl: "https://github.com/o/r/actions/runs/100",
        workflowRunId: "100",
        jobId: null,
        bucket: "pending",
      },
    ]);
  });
});
