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
    page: 0,
    totalCount: 0,
    hasNextPage: false,
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
    page: 0,
    totalCount: sampleTUIPRs.length,
    hasNextPage: false,
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
    page: 0,
    totalCount: 0,
    hasNextPage: false,
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
    page: 0,
    totalCount: 0,
    hasNextPage: false,
    error: "Could not authenticate. Run `gh auth status` to confirm.",
    errorKind: "authentication",
    ...overrides,
  }
}
