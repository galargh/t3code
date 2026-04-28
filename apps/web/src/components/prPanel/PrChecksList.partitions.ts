import type { GitPrCheckBucket, GitPullRequestCheck } from "@t3tools/contracts";

/**
 * Order in which buckets are rendered as collapsible groups. `fail` is first
 * because it's the bucket users care about; the empty buckets are skipped
 * entirely by the renderer.
 */
export const PR_CHECK_BUCKET_ORDER: ReadonlyArray<GitPrCheckBucket> = [
  "fail",
  "pending",
  "pass",
  "skipping",
  "cancel",
];

export type PartitionedChecks = Readonly<Record<GitPrCheckBucket, GitPullRequestCheck[]>>;

export function partitionChecksByBucket(
  checks: ReadonlyArray<GitPullRequestCheck>,
): PartitionedChecks {
  const partitions: Record<GitPrCheckBucket, GitPullRequestCheck[]> = {
    pass: [],
    fail: [],
    pending: [],
    skipping: [],
    cancel: [],
  };
  for (const check of checks) {
    partitions[check.bucket].push(check);
  }
  return partitions;
}

export interface ChecksSummary {
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
}

export function summarizeChecks(checks: ReadonlyArray<GitPullRequestCheck>): ChecksSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of checks) {
    if (check.bucket === "pass") passed += 1;
    else if (check.bucket === "fail") failed += 1;
    else if (check.bucket === "pending") pending += 1;
  }
  return { passed, failed, pending };
}
