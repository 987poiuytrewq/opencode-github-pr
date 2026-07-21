import { PRFilter, DashboardStatus, type DashboardState } from "../../plugins/domain/types"
import { sampleTUIPRs } from "./tui-fixtures"

export function loadingState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    status: DashboardStatus.Loading,
    repo: { owner: "foo", repo: "bar" },
    prs: [],
    fetchedAt: null,
    threadCounts: new Map(),
    branchRules: new Map(),
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
    threadCounts: new Map(),
    branchRules: new Map([
      ["main", 1],
      ["feat/login", 1],
      ["fix/race", 2],
      ["refactor", 1],
      ["docs", 0],
    ]),
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
    threadCounts: new Map(),
    branchRules: new Map(),
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
    threadCounts: new Map(),
    branchRules: new Map(),
    filter: PRFilter.Author,
    error: "Could not authenticate. Run `gh auth status` to confirm.",
    ...overrides,
  }
}
