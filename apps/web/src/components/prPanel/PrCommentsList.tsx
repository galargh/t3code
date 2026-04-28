import type { GitPullRequestComment } from "@t3tools/contracts";
import { ChevronDownIcon, ExternalLinkIcon, MessageSquareIcon } from "lucide-react";
import { useMemo } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

import { useMultiSelectState } from "./PrPanelMultiSelectState";

export function PrCommentsList(props: {
  comments: ReadonlyArray<GitPullRequestComment> | null;
  isLoading: boolean;
  isError: boolean;
  /** Fallback URL used when a comment has no `url` (e.g. older review payloads). */
  fallbackUrl: string | null;
  onQuoteSingle: (comment: GitPullRequestComment) => void;
  onQuoteMany: (comments: ReadonlyArray<GitPullRequestComment>) => void;
}) {
  const { selected, toggle, clear } = useMultiSelectState<string>();
  const commentsById = useMemo(() => {
    const map = new Map<string, GitPullRequestComment>();
    for (const comment of props.comments ?? []) {
      map.set(comment.id, comment);
    }
    return map;
  }, [props.comments]);
  const selectedComments = useMemo(() => {
    const out: GitPullRequestComment[] = [];
    for (const id of selected) {
      const comment = commentsById.get(id);
      if (comment) out.push(comment);
    }
    return out;
  }, [commentsById, selected]);
  const totalCount = props.comments?.length ?? null;
  const selectedCount = selectedComments.length;

  return (
    <Collapsible defaultOpen={false} className="rounded-md border border-border/60 bg-card/30">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 text-foreground hover:bg-muted/40"
              aria-label="Toggle comments"
            >
              <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform data-panel-open:rotate-0 data-panel-closed:-rotate-90" />
              <MessageSquareIcon className="size-3 text-muted-foreground" />
              <span className="font-medium text-foreground">Comments</span>
              {totalCount !== null && <span className="text-muted-foreground">{totalCount}</span>}
            </button>
          }
        />
        {selectedCount > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                props.onQuoteMany(selectedComments);
                clear();
              }}
            >
              Quote {selectedCount} in chat
            </Button>
            <Button size="xs" variant="ghost" onClick={clear}>
              Clear
            </Button>
          </div>
        )}
      </header>
      <CollapsiblePanel>
        {props.isLoading && props.comments === null ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">Loading comments…</div>
        ) : props.isError ? (
          <div className="px-3 py-2 text-xs text-red-500/80">Failed to load comments.</div>
        ) : (props.comments ?? []).length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">No comments yet.</div>
        ) : (
          <ul className="divide-y divide-border/40">
            {(props.comments ?? []).map((comment) => (
              <PrCommentRow
                key={comment.id}
                comment={comment}
                fallbackUrl={props.fallbackUrl}
                isSelected={selected.has(comment.id)}
                onToggleSelect={() => toggle(comment.id)}
                onQuote={() => props.onQuoteSingle(comment)}
              />
            ))}
          </ul>
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function PrCommentRow(props: {
  comment: GitPullRequestComment;
  fallbackUrl: string | null;
  isSelected: boolean;
  onToggleSelect: () => void;
  onQuote: () => void;
}) {
  const { comment } = props;
  const viewUrl = comment.url ?? props.fallbackUrl;
  const formattedTimestamp = useMemo(() => formatTimestamp(comment.createdAt), [comment.createdAt]);
  return (
    <li className="px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={props.isSelected}
          onCheckedChange={props.onToggleSelect}
          className="mt-0.5"
          aria-label={`Select comment from ${comment.author}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/90">@{comment.author}</span>
            {comment.filePath && (
              <span className="truncate text-foreground/70">
                {comment.filePath}
                {comment.line ? `:${comment.line}` : ""}
              </span>
            )}
            {formattedTimestamp.length > 0 && <span>{formattedTimestamp}</span>}
            {comment.kind === "review_thread" && comment.isResolved === true && (
              <Badge variant="outline" size="sm" className="text-emerald-600 dark:text-emerald-300">
                Resolved
              </Badge>
            )}
          </div>
          <div className="mt-1">
            <ChatMarkdown text={comment.body} cwd={undefined} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {viewUrl && (
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            >
              View
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
          <Button size="xs" variant="outline" onClick={props.onQuote}>
            Quote in chat
          </Button>
        </div>
      </div>
    </li>
  );
}

function formatTimestamp(value: string): string {
  if (value.length === 0) return "";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Date(ts).toLocaleString();
}
