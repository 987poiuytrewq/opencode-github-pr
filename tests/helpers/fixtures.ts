import type { PR } from "../../plugins/pr-dashboard"

export function makePR(overrides: Partial<PR> = {}): PR {
  return {
    number: 1,
    title: "Test PR",
    author: { login: "alice" },
    headRefName: "feature",
    baseRefName: "main",
    url: "https://github.com/foo/bar/pull/1",
    createdAt: new Date().toISOString(),
    isDraft: false,
    mergeable: "MERGEABLE",
    reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: {
      state: "SUCCESS",
      contexts: [],
    },
    reviews: [],
    comments: [],
    latestReviews: [],
    ...overrides,
  }
}

export const samplePRs: PR[] = [
  makePR({
    number: 10,
    title: "Add login flow",
    author: { login: "alice" },
    headRefName: "feat/login",
    baseRefName: "main",
    reviewDecision: "APPROVED",
    statusCheckRollup: { state: "SUCCESS" },
    reviews: [{ author: { login: "bob" }, state: "APPROVED" }],
  }),
  makePR({
    number: 11,
    title: "Fix race condition",
    author: { login: "bob" },
    headRefName: "fix/race",
    baseRefName: "main",
    reviewDecision: "CHANGES_REQUESTED",
    statusCheckRollup: { state: "FAILURE" },
    reviews: [
      { author: { login: "carol" }, state: "CHANGES_REQUESTED" },
    ],
  }),
  makePR({
    number: 12,
    title: "WIP: refactor",
    author: { login: "alice" },
    headRefName: "refactor",
    baseRefName: "main",
    isDraft: true,
    reviewDecision: null,
    statusCheckRollup: null,
    reviews: [],
  }),
  makePR({
    number: 13,
    title: "Update docs",
    author: { login: "carol" },
    headRefName: "docs",
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: { state: "PENDING" },
    reviews: [],
  }),
]
