import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeGitHubPullRequestDetailJson } from "./githubPullRequestDetail.ts";

describe("decodeGitHubPullRequestDetailJson", () => {
  it("normalizes an open clean PR", () => {
    const raw = JSON.stringify({
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "Add a feature",
      body: "Body",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      baseRefName: "main",
      headRefName: "feat/x",
      author: { login: "alice", name: "Alice" },
      reviewDecision: "APPROVED",
      autoMergeRequest: null,
    });

    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toEqual({
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "Add a feature",
      body: "Body",
      state: "open",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      baseRefName: "main",
      headRefName: "feat/x",
      author: { login: "alice", name: "Alice" },
      reviewDecision: "APPROVED",
      autoMergeRequest: null,
    });
  });

  it("normalizes a queued auto-merge request (lowercases mergeMethod, defaults missing login)", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "Queued PR",
      body: null,
      state: "OPEN",
      baseRefName: "main",
      headRefName: "feat/x",
      author: { login: "alice" },
      autoMergeRequest: {
        mergeMethod: "SQUASH",
        enabledAt: "2026-04-28T12:00:00Z",
        enabledBy: { login: "alice" },
      },
    });

    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.autoMergeRequest).toEqual({
      mergeMethod: "squash",
      enabledAt: "2026-04-28T12:00:00Z",
      enabledBy: { login: "alice" },
    });
  });

  it("treats an unknown mergeMethod as no auto-merge", () => {
    const raw = JSON.stringify({
      number: 42,
      title: "Bad",
      baseRefName: "main",
      headRefName: "feat/x",
      autoMergeRequest: { mergeMethod: "TELEPORT", enabledBy: { login: "alice" } },
    });

    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.autoMergeRequest).toBeNull();
  });

  it("derives merged state from mergedAt", () => {
    const raw = JSON.stringify({
      number: 1,
      title: "x",
      body: null,
      state: "CLOSED",
      mergedAt: "2025-01-01T00:00:00Z",
      isDraft: false,
      baseRefName: "main",
      headRefName: "topic",
      author: null,
    });

    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.state).toBe("merged");
    expect(result.success.author).toEqual({ login: "ghost", name: null });
    expect(result.success.body).toBe("");
  });

  it("treats unknown mergeStateStatus / reviewDecision as UNKNOWN / null", () => {
    const raw = JSON.stringify({
      number: 7,
      title: "y",
      baseRefName: "main",
      headRefName: "wip",
      mergeable: "BANANA",
      mergeStateStatus: "WHATEVER",
      reviewDecision: "GIBBERISH",
      author: { login: "bob" },
    });

    const result = decodeGitHubPullRequestDetailJson(raw);
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success.mergeable).toBe("UNKNOWN");
    expect(result.success.mergeStateStatus).toBe("UNKNOWN");
    expect(result.success.reviewDecision).toBeNull();
  });

  it("fails to decode obviously malformed JSON", () => {
    const result = decodeGitHubPullRequestDetailJson("{ not json");
    expect(Result.isFailure(result)).toBe(true);
  });
});
