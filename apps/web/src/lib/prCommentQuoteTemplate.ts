/**
 * Builds a markdown-quoted version of a PR comment for inserting into
 * the composer draft. Each body line is prefixed with `> `, and a header
 * line credits the author with the comment's file/line and timestamp
 * when available.
 */
export interface QuoteCommentInput {
  author: string;
  body: string;
  filePath?: string | null;
  line?: number | null;
  createdAt?: string | null;
}

function quoteBodyLines(body: string): string {
  // Normalize CRLF and collapse trailing newlines.
  const normalized = body.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
  if (normalized.length === 0) {
    return "> ";
  }
  return normalized
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function header(input: QuoteCommentInput): string {
  const author = input.author.trim().length > 0 ? input.author.trim() : "ghost";
  const fileSegment =
    input.filePath && input.filePath.trim().length > 0
      ? input.line !== null && input.line !== undefined && input.line > 0
        ? ` on ${input.filePath.trim()}:${input.line}`
        : ` on ${input.filePath.trim()}`
      : "";
  const tsSegment =
    input.createdAt && input.createdAt.trim().length > 0 ? ` (${input.createdAt.trim()})` : "";
  return `> @${author}${fileSegment}${tsSegment}`;
}

export function buildPrCommentQuote(input: QuoteCommentInput): string {
  return `${header(input)}\n${quoteBodyLines(input.body)}`;
}
