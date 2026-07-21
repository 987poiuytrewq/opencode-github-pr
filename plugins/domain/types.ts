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
  author: { login: string } | null
  headRefName: string
  baseRefName: string
  reviewDecision: string | null
  mergeable: string
  mergeStateStatus: string | null
  createdAt: string
  updatedAt: string
  // Fields are optional because the two mappers populate different subsets:
  // the GraphQL search mapper only sets `state`, while the REST mapper sets
  // `name`/`conclusion`/`status`. classifyCI reads them defensively.
  statusCheckRollup: Array<{ name?: string; conclusion?: string | null; status?: string; state?: string }> | null
  reviewRequests: Array<{ login: string }> | null
  latestReviews: Array<{ author: { login: string }; state: string; createdAt: string }> | null
  assignees: Array<{ login: string }> | null
}

export type Repo = { owner: string; repo: string }

export enum DashboardStatus {
  Loading = "loading",
  Ok = "ok",
  NoRepo = "no-repo",
  Error = "error",
}

export enum PRFilter {
  Author = "author",
  Assignee = "assignee",
}

// Canonical filter cycle order, used by the dashboard header button.
export const FILTERS: PRFilter[] = [PRFilter.Author, PRFilter.Assignee]

export type DashboardState = {
  status: DashboardStatus
  repo: Repo | null
  prs: PR[]
  fetchedAt: number | null
  threadCounts: Map<number, ReviewerThreadCounts>
  branchRules: Map<string, number | null>
  filter: PRFilter
  error?: string
}

export type ReviewerThreadCounts = Map<string, { unresolved: number; resolved: number }>

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
  cycleFilter: () => void
}
