import type { PR, PRScope, PRStatusFilter, Repo } from "./types"

export const PR_SCOPES: PRScope[] = ["branch", "author", "assignee", "all"]
export const PR_STATUS_FILTERS: PRStatusFilter[] = ["open", "closed", "all"]

// GitHub search returns at most this many results for any query, however
// many match. Page counts are capped to it.
export const SEARCH_RESULT_LIMIT = 1000

export function nextPRScope(scope: PRScope): PRScope {
  return PR_SCOPES[(PR_SCOPES.indexOf(scope) + 1) % PR_SCOPES.length]
}

export function nextPRStatusFilter(status: PRStatusFilter): PRStatusFilter {
  return PR_STATUS_FILTERS[(PR_STATUS_FILTERS.indexOf(status) + 1) % PR_STATUS_FILTERS.length]
}

// Build the GitHub search query for a scope and status filter, so GitHub
// does the filtering. Returns null when the scope can't match anything
// (the branch scope without a current branch), so callers can skip the
// request.
export function prSearchQuery(
  repo: Repo,
  scope: PRScope,
  status: PRStatusFilter,
  currentBranch: string | null,
): string | null {
  const terms = [`repo:${repo.owner}/${repo.repo}`, "is:pr"]
  switch (scope) {
    case "branch":
      if (!currentBranch) return null
      terms.push(`head:${quoteSearchValue(currentBranch)}`)
      break
    case "author":
      terms.push("author:@me")
      break
    case "assignee":
      terms.push("assignee:@me")
      break
    case "all":
      break
  }
  if (status !== "all") terms.push(`is:${status}`)
  terms.push("sort:updated-desc")
  return terms.join(" ")
}

function quoteSearchValue(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

// Local equivalent of prSearchQuery, for data that isn't on GitHub (the
// demo fixtures).
export function filterPRs(
  prs: PR[],
  scope: PRScope,
  status: PRStatusFilter,
  currentBranch: string | null,
  viewerLogin: string | null,
): PR[] {
  const login = viewerLogin?.toLowerCase()
  return prs.filter((pr) => {
    const matchesScope = (() => {
      switch (scope) {
        case "branch":
          return currentBranch !== null && pr.headRefName === currentBranch
        case "author":
          return login !== undefined && pr.authorLogin.toLowerCase() === login
        case "assignee":
          return login !== undefined && pr.assigneeLogins.some((assignee) => assignee.toLowerCase() === login)
        case "all":
          return true
      }
    })()
    const matchesStatus =
      status === "all" ||
      (status === "open" ? !pr.isClosed : pr.isClosed)
    return matchesScope && matchesStatus
  })
}
