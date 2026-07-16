// PR list filtering by author/assigned/all and current user.

import type { TuiPR, Filter } from "./types"

export const FILTERS: Filter[] = ["author", "assigned", "all"]

export function filterPRs(
  prs: TuiPR[],
  filter: Filter,
  currentUser: string | null,
): TuiPR[] {
  if (filter === "all") return prs
  if (!currentUser) return []
  const user = currentUser.toLowerCase()
  if (filter === "author")
    return prs.filter((p) => p.author?.login?.toLowerCase() === user)
  if (filter === "assigned")
    return prs.filter((p) => p.assignees?.some((a) => a.login?.toLowerCase() === user))
  return prs
}
