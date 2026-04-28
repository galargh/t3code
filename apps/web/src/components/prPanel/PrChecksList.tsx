import type {
  GitPrCheckBucket,
  GitPrCheckConclusion,
  GitPrCheckStatus,
  GitPullRequestCheck,
} from "@t3tools/contracts";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  ShieldOffIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

import {
  PR_CHECK_BUCKET_ORDER,
  partitionChecksByBucket,
  summarizeChecks,
} from "./PrChecksList.partitions";
import { useMultiSelectState } from "./PrPanelMultiSelectState";

const BUCKET_LABELS: Record<GitPrCheckBucket, string> = {
  fail: "Failing",
  pending: "In progress",
  pass: "Passing",
  skipping: "Skipped",
  cancel: "Cancelled",
};

export function PrChecksList(props: {
  checks: ReadonlyArray<GitPullRequestCheck> | null;
  isLoading: boolean;
  isError: boolean;
  onRerunFailed: (workflowRunId: string) => void;
  onRerunJob: (jobId: string) => void;
  onQuoteSingleFailingCheck: (check: GitPullRequestCheck) => void;
  onQuoteFailingChecks: (checks: ReadonlyArray<GitPullRequestCheck>) => void;
  isRerunPending: boolean;
}) {
  // Memoize the empty fallback so child memos see a stable reference.
  const checks = useMemo<ReadonlyArray<GitPullRequestCheck>>(
    () => props.checks ?? [],
    [props.checks],
  );
  const partitions = useMemo(() => partitionChecksByBucket(checks), [checks]);
  const summary = useMemo(() => summarizeChecks(checks), [checks]);
  const failedRunIds = useMemo(
    () =>
      Array.from(
        new Set(
          partitions.fail
            .filter((c) => c.workflowRunId !== null)
            .map((c) => c.workflowRunId as string),
        ),
      ),
    [partitions.fail],
  );

  return (
    <section className="rounded-md border border-border/60 bg-card/30">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">Checks</span>
          {!props.isLoading && props.checks !== null && (
            <span className="text-muted-foreground">
              {summary.passed} passed · {summary.failed} failed · {summary.pending} in progress
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
      ) : checks.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No checks reported.</div>
      ) : (
        <div className="divide-y divide-border/40">
          {PR_CHECK_BUCKET_ORDER.filter((bucket) => partitions[bucket].length > 0).map((bucket) => (
            <PrChecksBucketGroup
              key={bucket}
              bucket={bucket}
              checks={partitions[bucket]}
              defaultOpen={bucket === "fail"}
              onRerunJob={props.onRerunJob}
              onQuoteSingleFailingCheck={props.onQuoteSingleFailingCheck}
              onQuoteFailingChecks={props.onQuoteFailingChecks}
              isRerunPending={props.isRerunPending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PrChecksBucketGroup(props: {
  bucket: GitPrCheckBucket;
  checks: ReadonlyArray<GitPullRequestCheck>;
  defaultOpen: boolean;
  onRerunJob: (jobId: string) => void;
  onQuoteSingleFailingCheck: (check: GitPullRequestCheck) => void;
  onQuoteFailingChecks: (checks: ReadonlyArray<GitPullRequestCheck>) => void;
  isRerunPending: boolean;
}) {
  const { selected, toggle, clear } = useMultiSelectState<string>();
  const checksByKey = useMemo(() => {
    const map = new Map<string, GitPullRequestCheck>();
    for (const check of props.checks) {
      map.set(checkKey(check), check);
    }
    return map;
  }, [props.checks]);
  const selectedChecks = useMemo(() => {
    const out: GitPullRequestCheck[] = [];
    for (const id of selected) {
      const check = checksByKey.get(id);
      if (check) out.push(check);
    }
    return out;
  }, [checksByKey, selected]);

  const isFailing = props.bucket === "fail";
  const selectedCount = selectedChecks.length;

  return (
    <Collapsible defaultOpen={props.defaultOpen}>
      <header className="flex items-center gap-2 px-3 py-2 text-xs">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/40"
              aria-label={`Toggle ${BUCKET_LABELS[props.bucket]}`}
            >
              <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform data-panel-open:rotate-0 data-panel-closed:-rotate-90" />
              <BucketIcon bucket={props.bucket} />
              <span className="font-medium text-foreground/90">{BUCKET_LABELS[props.bucket]}</span>
              <span className="text-muted-foreground">{props.checks.length}</span>
            </button>
          }
        />
        {isFailing && selectedCount > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                props.onQuoteFailingChecks(selectedChecks);
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
        <ul className="divide-y divide-border/40">
          {props.checks.map((check) => (
            <PrCheckRow
              key={checkKey(check)}
              check={check}
              isFailing={isFailing}
              isSelected={selected.has(checkKey(check))}
              onToggleSelect={isFailing ? () => toggle(checkKey(check)) : undefined}
              onRerunJob={props.onRerunJob}
              onQuote={isFailing ? () => props.onQuoteSingleFailingCheck(check) : undefined}
              isRerunPending={props.isRerunPending}
            />
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function PrCheckRow(props: {
  check: GitPullRequestCheck;
  isFailing: boolean;
  isSelected: boolean;
  onToggleSelect?: (() => void) | undefined;
  onRerunJob: (jobId: string) => void;
  onQuote?: (() => void) | undefined;
  isRerunPending: boolean;
}) {
  const { check } = props;
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-xs">
      {props.onToggleSelect ? (
        <Checkbox
          checked={props.isSelected}
          onCheckedChange={props.onToggleSelect}
          className="mt-0.5"
          aria-label={`Select check ${check.name}`}
        />
      ) : (
        <CheckStatusIcon
          status={check.status}
          conclusion={check.conclusion}
          bucket={check.bucket}
        />
      )}
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
      {props.isFailing && props.onQuote && (
        <Button size="xs" variant="ghost" onClick={props.onQuote}>
          Quote
        </Button>
      )}
      {props.isFailing && check.jobId && (
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

function BucketIcon(props: { bucket: GitPrCheckBucket }) {
  const cls = "size-3.5";
  switch (props.bucket) {
    case "pass":
      return <CheckCircle2Icon className={`${cls} text-emerald-500`} />;
    case "fail":
      return <XCircleIcon className={`${cls} text-red-500`} />;
    case "pending":
      return <ClockIcon className={`${cls} text-amber-500`} />;
    case "skipping":
      return <CircleDashedIcon className={`${cls} text-zinc-400`} />;
    case "cancel":
      return <ShieldOffIcon className={`${cls} text-zinc-400`} />;
  }
}

function checkKey(check: GitPullRequestCheck): string {
  return `${check.workflow ?? "?"}:${check.name}`;
}
