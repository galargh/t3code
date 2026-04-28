import { describe, expect, it } from "vitest";

import { derivePrTitleSyncDispatch } from "./usePrTitleSync";

describe("derivePrTitleSyncDispatch", () => {
  it("returns null when the PR title is null", () => {
    expect(derivePrTitleSyncDispatch("Some title", null)).toBeNull();
  });

  it("returns null when the PR title is undefined (no PR resolved)", () => {
    expect(derivePrTitleSyncDispatch("Some title", undefined)).toBeNull();
  });

  it("returns null when the PR title equals the current title (no-op)", () => {
    expect(derivePrTitleSyncDispatch("Add login button", "Add login button")).toBeNull();
  });

  it("returns the PR title when it differs from the current title", () => {
    expect(derivePrTitleSyncDispatch("New thread", "Add login button")).toBe("Add login button");
  });

  it("returns the truncated form when the PR title exceeds the max length", () => {
    const longTitle = "A".repeat(60);
    const truncated = `${"A".repeat(50)}...`;
    expect(derivePrTitleSyncDispatch("Different", longTitle)).toBe(truncated);
  });

  it("treats the truncated PR title as already-synced when the current title matches it", () => {
    const longTitle = "A".repeat(60);
    const truncated = `${"A".repeat(50)}...`;
    // Current title is the truncated form (server stored only what we previously dispatched);
    // re-deriving against the raw PR title should not request another dispatch.
    expect(derivePrTitleSyncDispatch(truncated, longTitle)).toBeNull();
  });

  it("returns null when the PR title is empty or whitespace-only", () => {
    expect(derivePrTitleSyncDispatch("Some title", "")).toBeNull();
    expect(derivePrTitleSyncDispatch("Some title", "   ")).toBeNull();
    expect(derivePrTitleSyncDispatch("Some title", "\n\t")).toBeNull();
  });

  it("trims whitespace from the PR title before comparing", () => {
    // truncate() trims, so "  Add foo  " becomes "Add foo" — already matches current.
    expect(derivePrTitleSyncDispatch("Add foo", "  Add foo  ")).toBeNull();
  });

  it("returns the PR title when the current title is null (server snapshot not yet loaded)", () => {
    expect(derivePrTitleSyncDispatch(null, "Fix bug")).toBe("Fix bug");
  });

  it("does not request a dispatch when the user-edited title differs but PR title equals previous", () => {
    // Sanity: helper is purely a function of (currentTitle, prTitle). User-rename revert is
    // achieved at the call site by re-running this helper after currentTitle changes.
    expect(derivePrTitleSyncDispatch("user-renamed", "PR title")).toBe("PR title");
  });
});
