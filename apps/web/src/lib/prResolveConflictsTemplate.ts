/**
 * Builds a templated composer prompt that asks the agent to resolve
 * merge conflicts on the current PR's branch.
 *
 * Returned text is plain markdown — the caller appends it to the user's
 * existing draft (no auto-send).
 */
export interface ResolveConflictsPromptInput {
  prNumber: number;
  prTitle: string;
  baseBranch: string;
  headBranch: string;
}

export function buildResolveConflictsPrompt(input: ResolveConflictsPromptInput): string {
  const safeTitle = input.prTitle.trim();
  return [
    `The PR #${input.prNumber} "${safeTitle}" cannot be merged into ${input.baseBranch} due to conflicts.`,
    `Please:`,
    `  1. Pull the latest ${input.baseBranch} into ${input.headBranch} (or rebase).`,
    `  2. Resolve all conflict markers.`,
    `  3. Run the project's tests/lints.`,
    `  4. Commit and push the result.`,
    `Branch: ${input.headBranch}`,
  ].join("\n");
}
