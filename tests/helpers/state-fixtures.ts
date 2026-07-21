import { PRFilter, DashboardStatus, type DashboardState } from "../../plugins/domain/types"
import { sampleTUIPRs } from "./tui-fixtures"

export function loadingState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.Loading,
    repo: { owner: "foo", repo: "bar" },
    prs: [],
    fetchedAt: null,
    filter: PRFilter.Author,
    ...overrides,
  }
}

export function okState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.Ok,
    repo: { owner: "foo", repo: "bar" },
    prs: sampleTUIPRs,
    fetchedAt: Date.now(),
    filter: PRFilter.Author,
    ...overrides,
  }
}

export function noRepoState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.NoRepo,
    repo: null,
    prs: [],
    fetchedAt: Date.now(),
    filter: PRFilter.Author,
    ...overrides,
  }
}

export function errorState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.Error,
    repo: { owner: "foo", repo: "bar" },
    prs: [],
    fetchedAt: Date.now(),
    filter: PRFilter.Author,
    error: "Could not authenticate. Run `gh auth status` to confirm.",
    ...overrides,
  }
}
