import type { PR } from "../../plugins/pr-dashboard.tui"

export function makeTUIPR(overrides: Partial<PR> = {}): PR {
  return {
    number: 1,
    title: "Test PR",
    url: "https://github.com/foo/bar/pull/1",
    isDraft: false,
    author: { login: "alice" },
    headRefName: "feature",
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusCheckRollup: [],
    reviewRequests: [],
    latestReviews: [],
    assignees: [],
    ...overrides,
  }
}

export const sampleTUIPRs: PR[] = [
  makeTUIPR({
    number: 10,
    title: "Add login flow",
    author: { login: "alice" },
    headRefName: "feat/login",
    baseRefName: "main",
    reviewDecision: "APPROVED",
    latestReviews: [{ author: { login: "bob" }, state: "APPROVED", createdAt: "2024-01-01" }],
  }),
  makeTUIPR({
    number: 11,
    title: "Fix race condition",
    author: { login: "bob" },
    headRefName: "fix/race",
    baseRefName: "main",
    reviewDecision: "CHANGES_REQUESTED",
    statusCheckRollup: [{ name: "ci", conclusion: "FAILURE", status: "completed" }],
    latestReviews: [{ author: { login: "carol" }, state: "CHANGES_REQUESTED", createdAt: "2024-01-01" }],
  }),
  makeTUIPR({
    number: 12,
    title: "WIP: refactor",
    author: { login: "alice" },
    headRefName: "refactor",
    baseRefName: "main",
    isDraft: true,
    reviewDecision: null,
  }),
  makeTUIPR({
    number: 13,
    title: "Update docs",
    author: { login: "carol" },
    headRefName: "docs",
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: [{ name: "ci", conclusion: null, status: "in_progress" }],
  }),
]
