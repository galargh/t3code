import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeGitHubPullRequestCommentsJson,
  decodeGitHubPullRequestCommentsObject,
} from "./githubPullRequestComments.ts";

const SAMPLE_WRAPPER = {
  comments: [
    {
      id: 10,
      body: "issue 1",
      createdAt: "2025-01-02T00:00:00Z",
      author: { login: "alice" },
      url: "https://example.com/i10",
    },
  ],
  reviews: [
    {
      id: 20,
      body: "looks good",
      submittedAt: "2025-01-01T00:00:00Z",
      state: "APPROVED",
      author: { login: "bob" },
      url: "https://example.com/r20",
    },
    // Empty body review (Approve click) — skipped.
    { id: 21, body: "", submittedAt: "2025-01-03T00:00:00Z", author: { login: "bob" } },
  ],
  reviewThreads: [
    {
      id: "T1",
      isResolved: false,
      comments: [
        {
          id: 30,
          body: "rename this",
          createdAt: "2025-01-04T00:00:00Z",
          path: "src/foo.ts",
          line: 12,
          author: { login: "carol" },
        },
        {
          id: 31,
          body: "good idea",
          createdAt: "2025-01-05T00:00:00Z",
          path: "src/foo.ts",
          line: 12,
          inReplyTo: { id: 30 },
          author: { login: "alice" },
        },
      ],
    },
  ],
};

describe("decodeGitHubPullRequestCommentsJson", () => {
  it("flattens issues, reviews, and review-thread comments and sorts by createdAt", () => {
    const result = decodeGitHubPullRequestCommentsJson(JSON.stringify(SAMPLE_WRAPPER));
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    const ids = result.success.map((c) => c.id);
    expect(ids).toEqual(["review:20", "issue:10", "thread:T1:30", "thread:T1:31"]);
    const reply = result.success.find((c) => c.id === "thread:T1:31");
    expect(reply?.inReplyToId).toBe("thread:T1:30");
    expect(reply?.filePath).toBe("src/foo.ts");
    expect(reply?.line).toBe(12);
    expect(reply?.threadId).toBe("T1");
    expect(reply?.isResolved).toBe(false);
  });

  it("treats missing wrapper fields as empty arrays", () => {
    const result = decodeGitHubPullRequestCommentsJson("{}");
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toEqual([]);
  });
});

describe("decodeGitHubPullRequestCommentsObject", () => {
  it("matches the JSON variant when given the same input", () => {
    const objectResult = decodeGitHubPullRequestCommentsObject(SAMPLE_WRAPPER);
    const jsonResult = decodeGitHubPullRequestCommentsJson(JSON.stringify(SAMPLE_WRAPPER));
    expect(Result.isSuccess(objectResult)).toBe(true);
    expect(Result.isSuccess(jsonResult)).toBe(true);
    if (!Result.isSuccess(objectResult) || !Result.isSuccess(jsonResult)) return;
    expect(objectResult.success).toEqual(jsonResult.success);
  });

  it("accepts an empty wrapper object", () => {
    const result = decodeGitHubPullRequestCommentsObject({});
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(result.success).toEqual([]);
  });
});
