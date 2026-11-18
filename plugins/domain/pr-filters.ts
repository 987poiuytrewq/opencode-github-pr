import type { PR, PRScope, PRStatusFilter } from "./types"

export const PR_SCOPES: PRScope[] = ["branch", "author", "assignee", "all"]
export const PR_STATUS_FILTERS: PRStatusFilter[] = ["open", "closed", "all"]

export function nextPRScope(scope: PRScope): PRScope {
  return PR_SCOPES[(PR_SCOPES.indexOf(scope) + 1) % PR_SCOPES.length]
}

export function nextPRStatusFilter(status: PRStatusFilter): PRStatusFilter {
  return PR_STATUS_FILTERS[(PR_STATUS_FILTERS.indexOf(status) + 1) % PR_STATUS_FILTERS.length]
}

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
