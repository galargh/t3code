/**
 * Builds a markdown-quoted summary of a PR check (typically a failing one)
 * for inserting into the composer draft. Matches the visual shape of
 * {@link buildPrCommentQuote} so a chat with mixed comment + check quotes
 * stays consistent.
 */
export interface QuoteCheckInput {
  name: string;
  workflow?: string | null;
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
  detailsUrl?: string | null;
}

function trimOrEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function bucketLabel(bucket: QuoteCheckInput["bucket"]): string {
  switch (bucket) {
    case "fail":
      return "Failing check";
    case "pending":
      return "In-progress check";
    case "pass":
      return "Passing check";
    case "skipping":
      return "Skipped check";
    case "cancel":
      return "Cancelled check";
  }
}

export function buildPrCheckQuote(input: QuoteCheckInput): string {
  const name = trimOrEmpty(input.name);
  const workflow = trimOrEmpty(input.workflow);
  const url = trimOrEmpty(input.detailsUrl);
  const lines: string[] = [`> ${bucketLabel(input.bucket)}: ${name.length > 0 ? name : "?"}`];
  if (workflow.length > 0) {
    lines.push(`> Workflow: ${workflow}`);
  }
  if (url.length > 0) {
    lines.push(`> Run: ${url}`);
  }
  return lines.join("\n");
}

/**
 * Join multiple check quotes with a `>`-only separator line so the result
 * remains a single contiguous markdown blockquote when pasted into chat.
 */
export function buildPrChecksQuote(checks: ReadonlyArray<QuoteCheckInput>): string {
  return checks.map(buildPrCheckQuote).join("\n>\n");
}
