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
  additions: number
  deletions: number
  baseRefName: string
  mergeable: string
  statusCheckRollup: { state: string } | null
  reviewRequests: Array<{ login: string }> | null
  latestReviews: Array<{ author: { login: string }; state: string }> | null
}

export type Repo = { owner: string; repo: string }

export enum DashboardStatus {
  Loading = "loading",
  Ok = "ok",
  NoRepo = "no-repo",
  Error = "error",
}

export type DashboardState = {
  status: DashboardStatus
  repo: Repo | null
  prs: PR[]
  fetchedAt: number | null
  error?: string
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
  expanded: () => boolean
  toggleExpanded: () => void
}
