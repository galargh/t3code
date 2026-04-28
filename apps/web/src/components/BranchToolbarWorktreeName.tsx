import { CheckIcon, CopyIcon } from "lucide-react";
import { memo, useRef } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { formatWorktreePathForDisplay } from "../worktreeCleanup";
import { Button } from "./ui/button";
import { anchoredToastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const ANCHORED_TOAST_TIMEOUT_MS = 1000;

const onCopy = (ref: React.RefObject<HTMLButtonElement | null>) => {
  if (ref.current) {
    anchoredToastManager.add({
      data: {
        tooltipStyle: true,
      },
      positionerProps: {
        anchor: ref.current,
      },
      timeout: ANCHORED_TOAST_TIMEOUT_MS,
      title: "Copied!",
    });
  }
};

const onCopyError = (ref: React.RefObject<HTMLButtonElement | null>, error: Error) => {
  if (ref.current) {
    anchoredToastManager.add({
      data: {
        tooltipStyle: true,
      },
      positionerProps: {
        anchor: ref.current,
      },
      timeout: ANCHORED_TOAST_TIMEOUT_MS,
      title: "Failed to copy",
      description: error.message,
    });
  }
};

interface BranchToolbarWorktreeNameProps {
  worktreePath: string;
}

export const BranchToolbarWorktreeName = memo(function BranchToolbarWorktreeName({
  worktreePath,
}: BranchToolbarWorktreeNameProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => onCopy(ref),
    onError: (error: Error) => onCopyError(ref, error),
    timeout: ANCHORED_TOAST_TIMEOUT_MS,
  });

  const displayName = formatWorktreePathForDisplay(worktreePath);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Copy worktree path"
            disabled={isCopied}
            onClick={() => copyToClipboard(worktreePath)}
            ref={ref}
            type="button"
            size="xs"
            variant="ghost"
            className="max-w-48 font-medium"
          />
        }
      >
        <span className="truncate">{displayName}</span>
        {isCopied ? (
          <CheckIcon className="size-3 text-success" />
        ) : (
          <CopyIcon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>Copy worktree path</p>
        <p className="text-muted-foreground">{worktreePath}</p>
      </TooltipPopup>
    </Tooltip>
  );
});
