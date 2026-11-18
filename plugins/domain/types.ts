// Shared domain types for the PR dashboard plugins.
//
// Both the server and TUI pull PR data via Octokit, so they share a single
// PR shape (PR). Repo is non-null here; callers that may not have a repo
// use `Repo | null` explicitly.

export type PR = {
  number: number
  title: string
  url: string
  isDraft: boolean
  isMerged: boolean
  isClosed: boolean
  headRefName: string
  authorLogin: string
  assigneeLogins: string[]
  additions: number
  deletions: number
  baseRefName: string
  mergeable: string
  statusCheckRollup: { state: string } | null
  checkStatuses: string[] | null
  reviewThreads: Array<{ isResolved: boolean }> | null
  reviewRequests: Array<{ login: string }> | null
  latestReviews: Array<{ author: { login: string }; state: string }> | null
}

export type PRLinkTarget = "overview" | "mergeStatus" | "checks" | "files"

export type Repo = { owner: string; repo: string }

export type PRScope = "branch" | "author" | "assignee" | "all"
export type PRStatusFilter = "open" | "closed" | "all"

export enum DashboardStatus {
  Loading = "loading",
  Ok = "ok",
  NoRepo = "no-repo",
  Error = "error",
}

export type PRListErrorKind =
  | "authentication"
  | "forbidden"
  | "rate-limit"
  | "not-found"
  | "invalid-query"
  | "timeout"
  | "network"
  | "server"
  | "unknown"

export type DashboardState = {
  status: DashboardStatus
  repo: Repo | null
  prs: PR[]
  currentBranch: string | null
  viewerLogin: string | null
  fetchedAt: number | null
  error?: string
  errorKind?: PRListErrorKind
}

export type ReviewThread = {
  isResolved: boolean
  author: string
  body: string
  createdAt: string
  path: string
  line: number | null
}

// The public surface of useDashboard() — the signal/accessor pairs and
// actions exposed to the view layer and actions module. Defined here so
// the actions module can import it without depending on usePRData.
export interface DashboardContext {
  state: () => DashboardState
  refresh: () => Promise<void>
  refreshOne: (n: number) => Promise<void>
  selectedIdx: () => number
  setSelectedIdx: (n: number) => void
}
