import { describe, expect, it } from "vitest";
import { buildPrCommentQuote } from "./prCommentQuoteTemplate.ts";

describe("buildPrCommentQuote", () => {
  it("formats author, file:line, timestamp and quoted body", () => {
    const out = buildPrCommentQuote({
      author: "alice",
      body: "rename this\nto something better",
      filePath: "src/foo.ts",
      line: 10,
      createdAt: "2025-01-02T00:00:00Z",
    });

    expect(out).toBe(
      [
        `> @alice on src/foo.ts:10 (2025-01-02T00:00:00Z)`,
        `> rename this`,
        `> to something better`,
      ].join("\n"),
    );
  });

  it("omits file segment when path is missing", () => {
    const out = buildPrCommentQuote({
      author: "bob",
      body: "lgtm",
    });
    expect(out).toBe(`> @bob\n> lgtm`);
  });

  it("falls back to 'ghost' for empty author", () => {
    const out = buildPrCommentQuote({
      author: "",
      body: "x",
    });
    expect(out.startsWith("> @ghost")).toBe(true);
  });

  it("normalizes CRLF and trailing newlines", () => {
    const out = buildPrCommentQuote({
      author: "alice",
      body: "a\r\nb\n\n",
    });
    expect(out).toBe(`> @alice\n> a\n> b`);
  });
});
