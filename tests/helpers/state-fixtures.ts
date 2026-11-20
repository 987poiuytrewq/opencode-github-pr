import { DashboardStatus, type DashboardState } from "../../plugins/domain/types"
import { sampleTUIPRs } from "./tui-fixtures"

export function loadingState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.Loading,
    repo: { owner: "foo", repo: "bar" },
    prs: [],
    currentBranch: "feature",
    viewerLogin: "octocat",
    fetchedAt: null,
    pagination: {
      listing: "open",
      scope: "branch",
      scopeValue: "feature",
      cursor: null,
      hasMore: false,
      totalCount: null,
      pagesLoaded: 1,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      loading: false,
      limitReached: false,
    },
    ...overrides,
  }
}

export function okState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.Ok,
    repo: { owner: "foo", repo: "bar" },
    prs: sampleTUIPRs,
    currentBranch: "feature",
    viewerLogin: "octocat",
    fetchedAt: Date.now(),
    pagination: {
      listing: "open",
      scope: "branch",
      scopeValue: "feature",
      cursor: null,
      hasMore: false,
      totalCount: sampleTUIPRs.length,
      pagesLoaded: 1,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      loading: false,
      limitReached: false,
    },
    ...overrides,
  }
}

export function noRepoState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.NoRepo,
    repo: null,
    prs: [],
    currentBranch: null,
    viewerLogin: null,
    fetchedAt: Date.now(),
    pagination: {
      listing: "open",
      scope: "branch",
      scopeValue: null,
      cursor: null,
      hasMore: false,
      totalCount: 0,
      pagesLoaded: 1,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      loading: false,
      limitReached: false,
    },
    ...overrides,
  }
}

export function errorState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.Error,
    repo: { owner: "foo", repo: "bar" },
    prs: [],
    currentBranch: "feature",
    viewerLogin: "octocat",
    fetchedAt: Date.now(),
    pagination: {
      listing: "open",
      scope: "branch",
      scopeValue: "feature",
      cursor: null,
      hasMore: false,
      totalCount: null,
      pagesLoaded: 1,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      loading: false,
      limitReached: false,
    },
    error: "Could not authenticate. Run `gh auth status` to confirm.",
    errorKind: "authentication",
    ...overrides,
  }
}
