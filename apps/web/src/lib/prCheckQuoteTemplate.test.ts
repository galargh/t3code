import { describe, expect, it } from "vitest";
import { buildPrCheckQuote, buildPrChecksQuote } from "./prCheckQuoteTemplate.ts";

describe("buildPrCheckQuote", () => {
  it("formats name, workflow, and run URL for a failing check", () => {
    const out = buildPrCheckQuote({
      name: "test (node 24)",
      workflow: "CI",
      bucket: "fail",
      detailsUrl: "https://github.com/o/r/actions/runs/100/job/200",
    });
    expect(out).toBe(
      [
        "> Failing check: test (node 24)",
        "> Workflow: CI",
        "> Run: https://github.com/o/r/actions/runs/100/job/200",
      ].join("\n"),
    );
  });

  it("omits the workflow line when not provided", () => {
    const out = buildPrCheckQuote({
      name: "lint",
      bucket: "fail",
      detailsUrl: "https://example.com/run",
    });
    expect(out).toBe(["> Failing check: lint", "> Run: https://example.com/run"].join("\n"));
  });

  it("omits the run line when no detailsUrl is provided", () => {
    const out = buildPrCheckQuote({
      name: "build",
      workflow: "CI",
      bucket: "fail",
    });
    expect(out).toBe(["> Failing check: build", "> Workflow: CI"].join("\n"));
  });

  it("uses the bucket label when passing a non-fail bucket", () => {
    const out = buildPrCheckQuote({
      name: "deploy",
      bucket: "pending",
    });
    expect(out).toBe("> In-progress check: deploy");
  });

  it("falls back to '?' for empty name", () => {
    const out = buildPrCheckQuote({
      name: "",
      bucket: "fail",
    });
    expect(out).toBe("> Failing check: ?");
  });
});

describe("buildPrChecksQuote", () => {
  it("joins multiple check quotes with a blank `>` separator", () => {
    const out = buildPrChecksQuote([
      { name: "test", bucket: "fail", workflow: "CI", detailsUrl: "https://example.com/1" },
      { name: "lint", bucket: "fail" },
    ]);
    expect(out).toBe(
      [
        "> Failing check: test",
        "> Workflow: CI",
        "> Run: https://example.com/1",
        ">",
        "> Failing check: lint",
      ].join("\n"),
    );
  });

  it("returns an empty string for an empty list", () => {
    expect(buildPrChecksQuote([])).toBe("");
  });
});
