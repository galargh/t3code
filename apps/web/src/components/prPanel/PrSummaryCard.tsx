import type {
  GitPrAutoMergeRequest,
  GitPrMergeStateStatus,
  GitPullRequestDetail,
} from "@t3tools/contracts";

import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";

export function PrSummaryCard(props: { detail: GitPullRequestDetail | null; isLoading: boolean }) {
  if (props.isLoading && !props.detail) {
    return (
      <div className="rounded-md border border-border/60 bg-card/30 p-3 text-xs text-muted-foreground">
        Loading PR detail…
      </div>
    );
  }
  if (!props.detail) {
    return null;
  }
  const detail = props.detail;
  const body = detail.body.trim();
  return (
    <section className="rounded-md border border-border/60 bg-card/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{detail.baseRefName}</span>
        <span className="text-muted-foreground">←</span>
        <span className="text-foreground">{detail.headRefName}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground">@{detail.author.login}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {detail.autoMergeRequest && <AutoMergeBadge autoMergeRequest={detail.autoMergeRequest} />}
          <MergeStateBadge mergeStateStatus={detail.mergeStateStatus} />
          {detail.reviewDecision && <ReviewDecisionBadge value={detail.reviewDecision} />}
        </div>
      </div>
      {body.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Description</summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border/60 bg-background/70 p-2">
            <ChatMarkdown text={body} cwd={undefined} />
          </div>
        </details>
      )}
    </section>
  );
}

function MergeStateBadge(props: { mergeStateStatus: GitPrMergeStateStatus }) {
  const tone = (() => {
    switch (props.mergeStateStatus) {
      case "CLEAN":
        return "text-emerald-600 dark:text-emerald-300";
      case "BEHIND":
        return "text-amber-600 dark:text-amber-300";
      case "DIRTY":
      case "BLOCKED":
        return "text-red-600 dark:text-red-300";
      case "DRAFT":
        return "text-zinc-500 dark:text-zinc-400/80";
      case "UNSTABLE":
        return "text-amber-600 dark:text-amber-300";
      default:
        return "text-muted-foreground";
    }
  })();
  return (
    <Badge variant="outline" size="sm" className={tone}>
      Merge state: {props.mergeStateStatus.toLowerCase()}
    </Badge>
  );
}

function AutoMergeBadge(props: { autoMergeRequest: GitPrAutoMergeRequest }) {
  return (
    <Badge variant="outline" size="sm" className="text-emerald-600 dark:text-emerald-300">
      Auto-merge: {props.autoMergeRequest.mergeMethod} · @{props.autoMergeRequest.enabledBy.login}
    </Badge>
  );
}

function ReviewDecisionBadge(props: {
  value: NonNullable<GitPullRequestDetail["reviewDecision"]>;
}) {
  const label = props.value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const tone =
    props.value === "APPROVED"
      ? "text-emerald-600 dark:text-emerald-300"
      : props.value === "CHANGES_REQUESTED"
        ? "text-red-600 dark:text-red-300"
        : "text-amber-600 dark:text-amber-300";
  return (
    <Badge variant="outline" size="sm" className={tone}>
      {label}
    </Badge>
  );
}
