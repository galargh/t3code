/**
 * Search-param parsing for the PR status panel.
 *
 * Mirrors {@link DiffRouteSearch} so the route layer can compose the two
 * with a single `validateSearch` call. Only the toggle flag (`pr=1`) is
 * tracked — PR identity is read from `useGitStatus()` at render time.
 */

export interface PrRouteSearch {
  pr?: "1" | undefined;
}

function isPrOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

export function stripPrSearchParams<T extends Record<string, unknown>>(params: T): Omit<T, "pr"> {
  const { pr: _pr, ...rest } = params;
  return rest as Omit<T, "pr">;
}

export function parsePrRouteSearch(search: Record<string, unknown>): PrRouteSearch {
  const pr = isPrOpenValue(search.pr) ? "1" : undefined;
  return pr ? { pr } : {};
}
