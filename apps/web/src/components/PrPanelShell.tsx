import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import type { DiffPanelMode } from "./DiffPanelShell";
import { Skeleton } from "./ui/skeleton";

/**
 * Mirror of {@link DiffPanelShell} for the PR status panel. The PR rail
 * shares the same layout modes (`inline` | `sheet` | `sidebar`) and
 * Electron drag-region treatment so toggling between Diff and PR feels
 * consistent.
 */
export type PrPanelMode = DiffPanelMode;

function getHeaderRowClassName(mode: PrPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet";
  return cn(
    "flex items-center justify-between gap-2 px-4",
    shouldUseDragRegion
      ? "drag-region h-[52px] border-b border-border wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
      : "h-12 wco:max-h-[env(titlebar-area-height)]",
  );
}

export function PrPanelShell(props: { mode: PrPanelMode; header: ReactNode; children: ReactNode }) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet";
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
      )}
    >
      {shouldUseDragRegion ? (
        <div className={getHeaderRowClassName(props.mode)}>{props.header}</div>
      ) : (
        <div className="border-b border-border">
          <div className={getHeaderRowClassName(props.mode)}>{props.header}</div>
        </div>
      )}
      {props.children}
    </div>
  );
}

export function PrPanelHeaderSkeleton() {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Skeleton className="h-4 w-40 rounded-md" />
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
      <div className="flex shrink-0 gap-1">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
      </div>
    </>
  );
}

export function PrPanelLoadingState(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-card/25"
        role="status"
        aria-live="polite"
        aria-label={props.label}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="ml-auto h-4 w-20 rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-4">
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-9/12 rounded-full" />
          <Skeleton className="h-3 w-10/12 rounded-full" />
          <span className="sr-only">{props.label}</span>
        </div>
      </div>
    </div>
  );
}
