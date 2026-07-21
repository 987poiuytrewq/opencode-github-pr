import type { PR } from "../../plugins/domain/types"

export function makeTUIPR(overrides: Partial<PR> = {}): PR {
  return {
    number: 1,
    title: "Test PR",
    url: "https://github.com/foo/bar/pull/1",
    isDraft: false,
    baseRefName: "main",
    mergeable: "MERGEABLE",
    statusCheckRollup: null,
    reviewRequests: [],
    latestReviews: [],
    ...overrides,
  }
}

export const sampleTUIPRs: PR[] = [
  makeTUIPR({
    number: 10,
    title: "Add login flow",
    baseRefName: "main",
    latestReviews: [{ author: { login: "bob" }, state: "APPROVED" }],
  }),
  makeTUIPR({
    number: 11,
    title: "Fix race condition",
    baseRefName: "main",
    latestReviews: [{ author: { login: "carol" }, state: "CHANGES_REQUESTED" }],
  }),
  makeTUIPR({
    number: 12,
    title: "WIP: refactor",
    baseRefName: "main",
    isDraft: true,
  }),
  makeTUIPR({
    number: 13,
    title: "Update docs",
    baseRefName: "main",
  }),
]
