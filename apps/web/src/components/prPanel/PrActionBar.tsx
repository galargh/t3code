import type {
  GitPrMergeMethod,
  GitPullRequestDetail,
  GitRepositoryMergeSettings,
} from "@t3tools/contracts";
import { AlertTriangleIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";

const MERGE_METHOD_LABELS: Record<GitPrMergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

type PrimaryMergeLabel = "Merge" | "Enable auto-merge" | "Merge when ready";

interface PrimaryMergeAction {
  readonly label: PrimaryMergeLabel;
  readonly auto: boolean;
  readonly mergeWhenReady: boolean;
  readonly enabled: boolean;
}

function resolvePrimaryMergeAction(
  detail: GitPullRequestDetail,
  settings: GitRepositoryMergeSettings | null,
): PrimaryMergeAction {
  const mergeable =
    detail.state === "open" &&
    !detail.isDraft &&
    detail.mergeable !== "CONFLICTING" &&
    detail.mergeStateStatus !== "DIRTY";

  if (settings?.requiresMergeQueue) {
    return {
      label: "Merge when ready",
      auto: true,
      mergeWhenReady: true,
      enabled: mergeable,
    };
  }
  const isClean = detail.mergeStateStatus === "CLEAN" || detail.mergeStateStatus === "HAS_HOOKS";
  if (isClean) {
    return { label: "Merge", auto: false, mergeWhenReady: false, enabled: true };
  }
  return {
    label: "Enable auto-merge",
    auto: true,
    mergeWhenReady: false,
    enabled: mergeable,
  };
}

interface BranchAction {
  readonly label: "Update branch" | "Resolve conflicts";
  readonly handler: () => void;
}

function resolveBranchAction(
  detail: GitPullRequestDetail,
  onUpdateBranch: () => void,
  onResolveConflicts: () => void,
): BranchAction | null {
  if (detail.mergeStateStatus === "DIRTY" || detail.mergeable === "CONFLICTING") {
    return { label: "Resolve conflicts", handler: onResolveConflicts };
  }
  if (detail.mergeStateStatus === "BEHIND") {
    return { label: "Update branch", handler: onUpdateBranch };
  }
  return null;
}

export function PrActionBar(props: {
  detail: GitPullRequestDetail | null;
  mergeSettings: GitRepositoryMergeSettings | null;
  onMerge: (method: GitPrMergeMethod, auto: boolean) => void;
  onUpdateBranch: () => void;
  onResolveConflicts: () => void;
  onDisableAutoMerge: () => void;
  isMergePending: boolean;
  isUpdateBranchPending: boolean;
  isDisableAutoMergePending: boolean;
}) {
  const detail = props.detail;
  const settings = props.mergeSettings;

  // Default the merge method to repo default; persist user's session choice.
  const initialMethod: GitPrMergeMethod = settings?.defaultMergeMethod ?? "squash";
  const [chosenMethod, setChosenMethod] = useState<GitPrMergeMethod>(initialMethod);
  // When the repo default is loaded after mount, adopt it. We intentionally
  // depend ONLY on the repo default — don't clobber the user's manual choice
  // on unrelated re-renders.
  useEffect(() => {
    if (settings?.defaultMergeMethod) {
      setChosenMethod(settings.defaultMergeMethod);
    }
  }, [settings?.defaultMergeMethod]);

  const allowedMethods = useMemo<ReadonlyArray<GitPrMergeMethod>>(() => {
    if (!settings) return ["squash", "merge", "rebase"];
    const out: GitPrMergeMethod[] = [];
    if (settings.allowsSquashMerge) out.push("squash");
    if (settings.allowsMergeCommit) out.push("merge");
    if (settings.allowsRebaseMerge) out.push("rebase");
    return out.length > 0 ? out : ["squash", "merge", "rebase"];
  }, [settings]);

  // If the chosen method becomes disallowed (e.g. settings just loaded),
  // fall back to the first allowed one.
  useEffect(() => {
    if (!allowedMethods.includes(chosenMethod)) {
      const fallback = allowedMethods[0];
      if (fallback !== undefined) {
        setChosenMethod(fallback);
      }
    }
  }, [allowedMethods, chosenMethod]);

  if (detail === null) {
    return null;
  }

  const isAutoMergeEnabled = detail.autoMergeRequest !== null;
  const primary = resolvePrimaryMergeAction(detail, settings);
  const branchAction = resolveBranchAction(detail, props.onUpdateBranch, props.onResolveConflicts);

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
          <Group aria-label="Merge actions">
            <Button
              size="sm"
              variant="default"
              disabled={!primary.enabled || props.isMergePending}
              onClick={() => props.onMerge(chosenMethod, primary.auto)}
              title={`${MERGE_METHOD_LABELS[chosenMethod]}`}
            >
              {props.isMergePending ? <Spinner className="size-3" /> : null}
              {primary.label} ({chosenMethod})
            </Button>
            {allowedMethods.length > 1 && (
              <>
                <GroupSeparator />
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="default"
                        disabled={!primary.enabled || props.isMergePending}
                        aria-label="Choose merge method"
                      />
                    }
                  >
                    <ChevronDownIcon aria-hidden="true" className="size-4" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {allowedMethods.map((method) => (
                      <MenuItem
                        key={method}
                        onClick={() => {
                          setChosenMethod(method);
                          props.onMerge(method, primary.auto);
                        }}
                      >
                        {MERGE_METHOD_LABELS[method]}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              </>
            )}
          </Group>
        )}
        {branchAction && (
          <Button
            size="sm"
            variant={branchAction.label === "Resolve conflicts" ? "outline" : "outline"}
            disabled={branchAction.label === "Update branch" && props.isUpdateBranchPending}
            onClick={branchAction.handler}
          >
            {branchAction.label === "Update branch" && props.isUpdateBranchPending ? (
              <Spinner className="size-3" />
            ) : null}
            {branchAction.label === "Resolve conflicts" ? (
              <AlertTriangleIcon className="size-3 text-amber-500" />
            ) : null}
            {branchAction.label}
          </Button>
        )}
      </div>
    </section>
  );
}
