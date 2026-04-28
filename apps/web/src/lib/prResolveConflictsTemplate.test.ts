import { describe, expect, it } from "vitest";
import { buildResolveConflictsPrompt } from "./prResolveConflictsTemplate.ts";

describe("buildResolveConflictsPrompt", () => {
  it("renders a stable templated prompt", () => {
    const prompt = buildResolveConflictsPrompt({
      prNumber: 42,
      prTitle: "  Add feature X  ",
      baseBranch: "main",
      headBranch: "feature/x",
    });

    expect(prompt).toBe(
      [
        `The PR #42 "Add feature X" cannot be merged into main due to conflicts.`,
        `Please:`,
        `  1. Pull the latest main into feature/x (or rebase).`,
        `  2. Resolve all conflict markers.`,
        `  3. Run the project's tests/lints.`,
        `  4. Commit and push the result.`,
        `Branch: feature/x`,
      ].join("\n"),
    );
  });
});
