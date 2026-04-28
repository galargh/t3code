import { describe, expect, it } from "vitest";

import type { GitPrCheckBucket, GitPullRequestCheck } from "@t3tools/contracts";

import { partitionChecksByBucket, summarizeChecks } from "./PrChecksList.partitions";

function makeCheck(name: string, bucket: GitPrCheckBucket): GitPullRequestCheck {
  return {
    name,
    status: bucket === "pending" ? "IN_PROGRESS" : "COMPLETED",
    conclusion:
      bucket === "fail"
        ? "FAILURE"
        : bucket === "pass"
          ? "SUCCESS"
          : bucket === "skipping"
            ? "SKIPPED"
            : bucket === "cancel"
              ? "CANCELLED"
              : null,
    workflow: null,
    detailsUrl: null,
    workflowRunId: null,
    jobId: null,
    bucket,
  };
}

describe("partitionChecksByBucket", () => {
  it("groups checks into buckets while preserving order", () => {
    const checks: ReadonlyArray<GitPullRequestCheck> = [
      makeCheck("a", "pass"),
      makeCheck("b", "fail"),
      makeCheck("c", "pending"),
      makeCheck("d", "fail"),
      makeCheck("e", "skipping"),
    ];
    const partitions = partitionChecksByBucket(checks);
    expect(partitions.fail.map((check) => check.name)).toEqual(["b", "d"]);
    expect(partitions.pending.map((check) => check.name)).toEqual(["c"]);
    expect(partitions.pass.map((check) => check.name)).toEqual(["a"]);
    expect(partitions.skipping.map((check) => check.name)).toEqual(["e"]);
    expect(partitions.cancel).toHaveLength(0);
  });

  it("returns empty buckets for an empty list", () => {
    const partitions = partitionChecksByBucket([]);
    expect(partitions.pass).toHaveLength(0);
    expect(partitions.fail).toHaveLength(0);
    expect(partitions.pending).toHaveLength(0);
    expect(partitions.skipping).toHaveLength(0);
    expect(partitions.cancel).toHaveLength(0);
  });
});

describe("summarizeChecks", () => {
  it("counts the three primary buckets the header surfaces", () => {
    const summary = summarizeChecks([
      makeCheck("a", "pass"),
      makeCheck("b", "fail"),
      makeCheck("c", "fail"),
      makeCheck("d", "pending"),
      makeCheck("e", "skipping"),
    ]);
    expect(summary).toEqual({ passed: 1, failed: 2, pending: 1 });
  });
});
