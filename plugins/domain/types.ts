// Shared domain types for the PR dashboard plugins.
//
// Two PR shapes exist because the server's `gh pr list` and the TUI's
// `gh pr list` requests different JSON fields — the server uses
// `gh pr list --json number,title,author,...` (with a different field set
// than the TUI). The shapes here mirror what gh returns for each plugin.

export type ServerPR = {
  number: number
  title: string
  author: { login: string } | null
  headRefName: string
  baseRefName: string
  url: string
  createdAt: string
  isDraft: boolean
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  statusCheckRollup: {
    state: "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | null
    contexts?: { name?: string; state?: string }[]
  } | null
  reviews?: { author: { login: string }; state: string }[]
  comments?: { totalCount: number }[]
  latestReviews?: { author: { login: string }; state: string }[]
}

export type TuiPR = {
  number: number
  title: string
  url: string
  isDraft: boolean
  author: { login: string } | null
  headRefName: string
  baseRefName: string
  reviewDecision: string | null
  mergeable: string
  mergeStateStatus: string | null
  createdAt: string
  updatedAt: string
  statusCheckRollup: Array<{ name: string; conclusion: string | null; status: string; state?: string }> | null
  reviewRequests: Array<{ login: string }> | null
  latestReviews: Array<{ author: { login: string }; state: string; createdAt: string }> | null
  assignees: Array<{ login: string }> | null
}

export type Repo = { owner: string; repo: string } | null

export type Status = "loading" | "ok" | "no-repo" | "error"

export type Filter = "author" | "assigned" | "all"

export type State = {
  status: Status
  repo: Repo
  prs: TuiPR[]
  fetchedAt: number | null
  threadCounts: Map<number, ReviewerThreadCounts>
  branchRules: Map<string, number | null>
  filter: Filter
}

export type ReviewerThreadCounts = Map<string, { unresolved: number; resolved: number }>
