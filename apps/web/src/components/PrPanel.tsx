import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime";
import type {
  GitPrAutoMergeRequest,
  GitPrCheckBucket,
  GitPrCheckConclusion,
  GitPrCheckStatus,
  GitPrMergeMethod,
  GitPrMergeStateStatus,
  GitPullRequestCheck,
  GitPullRequestComment,
  GitPullRequestDetail,
} from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  ShieldOffIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useGitStatus } from "~/lib/gitStatusState";
import {
  invalidatePrQueries,
  prChecksQueryOptions,
  prCommentsQueryOptions,
  prDetailQueryOptions,
  prDisableAutoMergeMutationOptions,
  prMergeMutationOptions,
  prRerunChecksMutationOptions,
  prUpdateBranchMutationOptions,
} from "~/lib/gitReactQuery";
import { buildPrCommentQuote } from "~/lib/prCommentQuoteTemplate";
import { buildResolveConflictsPrompt } from "~/lib/prResolveConflictsTemplate";
import { stripPrSearchParams } from "../prRouteSearch";
import { useComposerHandleContext } from "../composerHandleContext";
import { useComposerDraftStore } from "../composerDraftStore";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { PrPanelShell, type PrPanelMode } from "./PrPanelShell";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface PrPanelProps {
  mode?: PrPanelMode;
}

export default function PrPanel({ mode = "inline" }: PrPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const composerHandleRef = useComposerHandleContext();
  const setPrompt = useComposerDraftStore((state) => state.setPrompt);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  // Read the active thread/project to learn the PR number we should track.
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const environmentId = activeThread?.environmentId ?? null;
  const gitStatusQuery = useGitStatus({ environmentId, cwd: activeCwd });
  const trackedPr = gitStatusQuery.data?.pr ?? null;
  const prNumber = trackedPr?.number ?? null;

  const closePr = useCallback(() => {
    if (!routeThreadRef) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(routeThreadRef),
      search: (previous) => stripPrSearchParams(previous),
    });
  }, [navigate, routeThreadRef]);

  const detailQuery = useQuery(prDetailQueryOptions({ environmentId, cwd: activeCwd, prNumber }));
  const checksQuery = useQuery(prChecksQueryOptions({ environmentId, cwd: activeCwd, prNumber }));
  const commentsQuery = useQuery(
    prCommentsQueryOptions({ environmentId, cwd: activeCwd, prNumber }),
  );

  const mergeMutation = useMutation(
    prMergeMutationOptions({ environmentId, cwd: activeCwd, prNumber, queryClient }),
  );
  const rerunMutation = useMutation(
    prRerunChecksMutationOptions({ environmentId, cwd: activeCwd, prNumber, queryClient }),
  );
  const updateBranchMutation = useMutation(
    prUpdateBranchMutationOptions({ environmentId, cwd: activeCwd, prNumber, queryClient }),
  );
  const disableAutoMergeMutation = useMutation(
    prDisableAutoMergeMutationOptions({ environmentId, cwd: activeCwd, prNumber, queryClient }),
  );

  const refresh = useCallback(() => {
    void invalidatePrQueries({
      queryClient,
      environmentId,
      cwd: activeCwd,
      prNumber,
    });
  }, [activeCwd, environmentId, prNumber, queryClient]);

  const detail = detailQuery.data?.detail ?? null;
  const checks = checksQuery.data?.checks ?? null;
  const comments = commentsQuery.data?.comments ?? null;

  const appendToDraft = useCallback(
    (text: string) => {
      if (!activeThread) return;
      const ref = scopeThreadRef(activeThread.environmentId, activeThread.id);
      const current = useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "";
      const next = current.length > 0 ? `${current}\n\n${text}` : text;
      setPrompt(ref, next);
      composerHandleRef?.current?.focusAtEnd();
    },
    [activeThread, composerHandleRef, setPrompt],
  );

  const onQuoteComment = useCallback(
    (comment: GitPullRequestComment) => {
      const quote = buildPrCommentQuote({
        author: comment.author,
        body: comment.body,
        filePath: comment.filePath,
        line: comment.line,
        createdAt: comment.createdAt,
      });
      appendToDraft(quote);
      toastManager.add(
        stackedThreadToast({ type: "success", title: "Comment quoted in composer" }),
      );
    },
    [appendToDraft],
  );

  const onResolveConflicts = useCallback(() => {
    if (!detail) return;
    const prompt = buildResolveConflictsPrompt({
      prNumber: detail.number,
      prTitle: detail.title,
      baseBranch: detail.baseRefName,
      headBranch: detail.headRefName,
    });
    appendToDraft(prompt);
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Conflict prompt added to composer",
      }),
    );
  }, [appendToDraft, detail]);

  const onMerge = useCallback(
    (method: GitPrMergeMethod, auto: boolean) => {
      mergeMutation.mutate(
        { method, auto },
        {
          onSuccess: (result) =>
            toastManager.add(
              stackedThreadToast({
                type: "success",
                title:
                  result.status === "queued"
                    ? `Auto-merge enabled for #${result.prNumber}`
                    : `PR #${result.prNumber} merged`,
              }),
            ),
          onError: (error) =>
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to merge PR",
                description: error instanceof Error ? error.message : undefined,
              }),
            ),
        },
      );
    },
    [mergeMutation],
  );

  const onUpdateBranch = useCallback(() => {
    updateBranchMutation.mutate(undefined, {
      onSuccess: () =>
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Branch updated on GitHub",
            description: "Pull locally to sync your worktree.",
          }),
        ),
      onError: (error) =>
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update branch",
            description: error instanceof Error ? error.message : undefined,
          }),
        ),
    });
  }, [updateBranchMutation]);

  const onDisableAutoMerge = useCallback(() => {
    disableAutoMergeMutation.mutate(undefined, {
      onSuccess: () =>
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Removed PR from auto-merge queue",
          }),
        ),
      onError: (error) =>
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to remove PR from queue",
            description: error instanceof Error ? error.message : undefined,
          }),
        ),
    });
  }, [disableAutoMergeMutation]);

  const onRerunFailed = useCallback(
    (workflowRunId: string) => {
      rerunMutation.mutate(
        { _tag: "all_failed", workflowRunId },
        {
          onSuccess: () =>
            toastManager.add(
              stackedThreadToast({ type: "success", title: "Re-running failed jobs" }),
            ),
          onError: (error) =>
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to rerun checks",
                description: error instanceof Error ? error.message : undefined,
              }),
            ),
        },
      );
    },
    [rerunMutation],
  );

  const onRerunJob = useCallback(
    (jobId: string) => {
      rerunMutation.mutate(
        { _tag: "job", jobId },
        {
          onSuccess: () =>
            toastManager.add(stackedThreadToast({ type: "success", title: "Re-running check" })),
          onError: (error) =>
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to rerun check",
                description: error instanceof Error ? error.message : undefined,
              }),
            ),
        },
      );
    },
    [rerunMutation],
  );

  const headerRow = (
    <PrPanelHeader
      detail={detail}
      prNumberFromStatus={prNumber}
      isLoading={detailQuery.isLoading || checksQuery.isLoading || commentsQuery.isLoading}
      isFetching={detailQuery.isFetching || checksQuery.isFetching || commentsQuery.isFetching}
      onRefresh={refresh}
      onClose={closePr}
    />
  );

  return (
    <PrPanelShell mode={mode} header={headerRow}>
      {!routeThreadRef ? (
        <EmptyState message="Select a thread to inspect its PR." />
      ) : prNumber === null ? (
        <EmptyState
          message={
            gitStatusQuery.data?.isRepo === false
              ? "PR panel is unavailable because this project is not a git repository."
              : "No open PR for this branch."
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <PrSummaryCard detail={detail} isLoading={detailQuery.isLoading} />
          <PrChecksList
            checks={checks}
            isLoading={checksQuery.isLoading}
            isError={checksQuery.isError}
            onRerunFailed={onRerunFailed}
            onRerunJob={onRerunJob}
            isRerunPending={rerunMutation.isPending}
          />
          <PrCommentsList
            comments={comments}
            isLoading={commentsQuery.isLoading}
            isError={commentsQuery.isError}
            onQuote={onQuoteComment}
          />
          <PrActionBar
            detail={detail}
            onMerge={onMerge}
            onUpdateBranch={onUpdateBranch}
            onResolveConflicts={onResolveConflicts}
            onDisableAutoMerge={onDisableAutoMerge}
            isMergePending={mergeMutation.isPending}
            isUpdateBranchPending={updateBranchMutation.isPending}
            isDisableAutoMergePending={disableAutoMergeMutation.isPending}
          />
        </div>
      )}
    </PrPanelShell>
  );
}

function PrPanelHeader(props: {
  detail: GitPullRequestDetail | null;
  prNumberFromStatus: number | null;
  isLoading: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { detail, prNumberFromStatus, isFetching, onRefresh, onClose } = props;
  const title = detail?.title ?? "Pull request";
  const number = detail?.number ?? prNumberFromStatus ?? null;
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {detail?.url ? (
          <a
            href={detail.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
            title={title}
          >
            {title}
          </a>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        )}
        {number !== null && (
          <span className="shrink-0 text-muted-foreground text-xs">#{number}</span>
        )}
        {detail && <PrStateBadge state={detail.state} isDraft={detail.isDraft} />}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={onRefresh}
                aria-label="Refresh PR data"
              >
                {isFetching ? <Spinner className="size-3" /> : <RefreshCwIcon className="size-3" />}
              </Button>
            }
          />
          <TooltipPopup side="bottom">Refresh</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close PR panel">
                <XIcon className="size-3" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">Close</TooltipPopup>
        </Tooltip>
      </div>
    </>
  );
}

function EmptyState(props: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
      {props.message}
    </div>
  );
}

function PrStateBadge(props: { state: "open" | "queued" | "closed" | "merged"; isDraft: boolean }) {
  if (props.isDraft) {
    return (
      <Badge variant="outline" size="sm" className="text-zinc-600 dark:text-zinc-300">
        Draft
      </Badge>
    );
  }
  if (props.state === "merged") {
    return (
      <Badge variant="outline" size="sm" className="text-violet-600 dark:text-violet-300">
        Merged
      </Badge>
    );
  }
  if (props.state === "closed") {
    return (
      <Badge variant="outline" size="sm" className="text-zinc-500 dark:text-zinc-400/80">
        Closed
      </Badge>
    );
  }
  if (props.state === "queued") {
    return (
      <Badge variant="outline" size="sm" className="text-amber-600 dark:text-amber-300">
        Queued
      </Badge>
    );
  }
  return (
    <Badge variant="outline" size="sm" className="text-emerald-600 dark:text-emerald-300">
      Open
    </Badge>
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

function PrSummaryCard(props: { detail: GitPullRequestDetail | null; isLoading: boolean }) {
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
      {detail.body.trim().length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Description</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border/60 bg-background/70 p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90">
            {detail.body}
          </pre>
        </details>
      )}
    </section>
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

function PrChecksList(props: {
  checks: ReadonlyArray<GitPullRequestCheck> | null;
  isLoading: boolean;
  isError: boolean;
  onRerunFailed: (workflowRunId: string) => void;
  onRerunJob: (jobId: string) => void;
  isRerunPending: boolean;
}) {
  const groups = useMemo(() => groupChecks(props.checks ?? []), [props.checks]);
  const failedRunIds = useMemo(
    () =>
      Array.from(
        new Set(
          (props.checks ?? [])
            .filter((c) => c.bucket === "fail" && c.workflowRunId !== null)
            .map((c) => c.workflowRunId as string),
        ),
      ),
    [props.checks],
  );

  return (
    <section className="rounded-md border border-border/60 bg-card/30">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">Checks</span>
          {!props.isLoading && props.checks !== null && (
            <span className="text-muted-foreground">
              {groups.passed} passed · {groups.failed} failed · {groups.pending} in progress
            </span>
          )}
        </div>
        {failedRunIds.length > 0 && (
          <Button
            size="xs"
            variant="outline"
            disabled={props.isRerunPending}
            onClick={() => failedRunIds.forEach((runId) => props.onRerunFailed(runId))}
          >
            Rerun all failed
          </Button>
        )}
      </header>
      {props.isLoading && props.checks === null ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">Loading checks…</div>
      ) : props.isError ? (
        <div className="px-3 py-2 text-xs text-red-500/80">Failed to load checks.</div>
      ) : (props.checks ?? []).length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No checks reported.</div>
      ) : (
        <ul className="divide-y divide-border/40">
          {(props.checks ?? []).map((check) => (
            <PrCheckRow
              key={`${check.workflow ?? "?"}:${check.name}`}
              check={check}
              onRerunJob={props.onRerunJob}
              isRerunPending={props.isRerunPending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PrCheckRow(props: {
  check: GitPullRequestCheck;
  onRerunJob: (jobId: string) => void;
  isRerunPending: boolean;
}) {
  const { check } = props;
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-xs">
      <CheckStatusIcon status={check.status} conclusion={check.conclusion} bucket={check.bucket} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">{check.name}</div>
        {check.workflow && (
          <div className="truncate text-[10px] text-muted-foreground">{check.workflow}</div>
        )}
      </div>
      {check.detailsUrl && (
        <a
          href={check.detailsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          View
          <ExternalLinkIcon className="size-3" />
        </a>
      )}
      {check.bucket === "fail" && check.jobId && (
        <Button
          size="xs"
          variant="outline"
          disabled={props.isRerunPending}
          onClick={() => props.onRerunJob(check.jobId as string)}
        >
          Rerun
        </Button>
      )}
    </li>
  );
}

function CheckStatusIcon(props: {
  status: GitPrCheckStatus;
  conclusion: GitPrCheckConclusion;
  bucket: GitPrCheckBucket;
}) {
  if (props.bucket === "pass") {
    return <CheckCircle2Icon className="size-3.5 text-emerald-500" />;
  }
  if (props.bucket === "fail") {
    return <XCircleIcon className="size-3.5 text-red-500" />;
  }
  if (props.bucket === "skipping") {
    return <CircleDashedIcon className="size-3.5 text-zinc-400" />;
  }
  if (props.bucket === "cancel") {
    return <ShieldOffIcon className="size-3.5 text-zinc-400" />;
  }
  return <ClockIcon className="size-3.5 text-amber-500" />;
}

function PrCommentsList(props: {
  comments: ReadonlyArray<GitPullRequestComment> | null;
  isLoading: boolean;
  isError: boolean;
  onQuote: (comment: GitPullRequestComment) => void;
}) {
  return (
    <section className="rounded-md border border-border/60 bg-card/30">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <MessageSquareIcon className="size-3 text-muted-foreground" />
        <span className="font-medium text-foreground">Comments</span>
        {props.comments !== null && (
          <span className="text-muted-foreground">{props.comments.length}</span>
        )}
      </header>
      {props.isLoading && props.comments === null ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">Loading comments…</div>
      ) : props.isError ? (
        <div className="px-3 py-2 text-xs text-red-500/80">Failed to load comments.</div>
      ) : (props.comments ?? []).length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No comments yet.</div>
      ) : (
        <ul className="divide-y divide-border/40">
          {(props.comments ?? []).map((comment) => (
            <PrCommentRow key={comment.id} comment={comment} onQuote={props.onQuote} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PrCommentRow(props: {
  comment: GitPullRequestComment;
  onQuote: (comment: GitPullRequestComment) => void;
}) {
  const { comment } = props;
  return (
    <li className="px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/90">@{comment.author}</span>
            {comment.filePath && (
              <span className="truncate text-foreground/70">
                {comment.filePath}
                {comment.line ? `:${comment.line}` : ""}
              </span>
            )}
            {comment.createdAt && <span>{formatTimestamp(comment.createdAt)}</span>}
            {comment.kind === "review_thread" && comment.isResolved === true && (
              <Badge variant="outline" size="sm" className="text-emerald-600 dark:text-emerald-300">
                Resolved
              </Badge>
            )}
          </div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-foreground/90">
            {comment.body}
          </pre>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {comment.url && (
            <a
              href={comment.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            >
              View
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
          <Button size="xs" variant="outline" onClick={() => props.onQuote(comment)}>
            Quote in draft
          </Button>
        </div>
      </div>
    </li>
  );
}

function PrActionBar(props: {
  detail: GitPullRequestDetail | null;
  onMerge: (method: GitPrMergeMethod, auto: boolean) => void;
  onUpdateBranch: () => void;
  onResolveConflicts: () => void;
  onDisableAutoMerge: () => void;
  isMergePending: boolean;
  isUpdateBranchPending: boolean;
  isDisableAutoMergePending: boolean;
}) {
  const detail = props.detail;
  if (detail === null) {
    return null;
  }

  const isAutoMergeEnabled = detail.autoMergeRequest !== null;
  const mergeable =
    detail.state === "open" &&
    !detail.isDraft &&
    detail.mergeable !== "CONFLICTING" &&
    detail.mergeStateStatus !== "DIRTY";
  const isClean = detail.mergeStateStatus === "CLEAN" || detail.mergeStateStatus === "HAS_HOOKS";
  const showUpdateBranch = detail.mergeStateStatus === "BEHIND";
  const showResolveConflicts =
    detail.mergeStateStatus === "DIRTY" || detail.mergeable === "CONFLICTING";

  const mergeLabel = isClean ? "Merge" : "Enable auto-merge";
  const auto = !isClean;

  return (
    <section className="sticky bottom-0 -mx-4 mt-2 border-t border-border/60 bg-background/95 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {isAutoMergeEnabled ? (
          <Button
            size="sm"
            variant="default"
            disabled={props.isDisableAutoMergePending}
            onClick={props.onDisableAutoMerge}
          >
            {props.isDisableAutoMergePending ? <Spinner className="size-3" /> : null}
            Remove from queue
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={!mergeable || props.isMergePending}
              onClick={() => props.onMerge("squash", auto)}
            >
              {props.isMergePending ? <Spinner className="size-3" /> : null}
              {mergeLabel} (squash)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!mergeable || props.isMergePending}
              onClick={() => props.onMerge("merge", auto)}
            >
              Merge commit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!mergeable || props.isMergePending}
              onClick={() => props.onMerge("rebase", auto)}
            >
              Rebase
            </Button>
          </>
        )}
        {showUpdateBranch && (
          <Button
            size="sm"
            variant="outline"
            disabled={props.isUpdateBranchPending}
            onClick={props.onUpdateBranch}
          >
            {props.isUpdateBranchPending ? <Spinner className="size-3" /> : null}
            Update branch
          </Button>
        )}
        {showResolveConflicts && (
          <Button size="sm" variant="outline" onClick={props.onResolveConflicts}>
            <AlertTriangleIcon className="size-3 text-amber-500" />
            Resolve conflicts with agent
          </Button>
        )}
      </div>
    </section>
  );
}

function groupChecks(checks: ReadonlyArray<GitPullRequestCheck>) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of checks) {
    if (check.bucket === "pass") passed += 1;
    else if (check.bucket === "fail") failed += 1;
    else if (check.bucket === "pending") pending += 1;
  }
  return { passed, failed, pending };
}

function formatTimestamp(value: string): string {
  if (value.length === 0) return "";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Date(ts).toLocaleString();
}
