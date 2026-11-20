import { describe, expect, test } from "bun:test"
import { mapPullFromGraphQL } from "../../plugins/infra/mappers"
import {
  PULL_REQUESTS_QUERY,
  PULL_REQUESTS_QUERY_LEGACY,
  PULL_REQUESTS_SEARCH_QUERY,
  PULL_REQUESTS_SEARCH_QUERY_LEGACY,
} from "../../plugins/infra/queries"

describe("GitHub response mappers", () => {
  test("queries merge readiness and review requests beyond the first five", () => {
    for (const query of [PULL_REQUESTS_QUERY, PULL_REQUESTS_SEARCH_QUERY]) {
      expect(query).toContain("mergeStateStatus")
      expect(query).toContain("reviewDecision")
      expect(query).toContain("reviewRequests(first: 100)")
      expect(query).toContain("... on Team { slug }")
    }
    for (const query of [PULL_REQUESTS_QUERY_LEGACY, PULL_REQUESTS_SEARCH_QUERY_LEGACY]) {
      expect(query).not.toContain("mergeStateStatus")
      expect(query).not.toContain("reviewDecision")
    }
  })

  test("maps expected GraphQL fields into the PR domain shape", () => {
    const pr = mapPullFromGraphQL({
      number: 12,
      title: "Update widgets",
      url: "https://github.com/acme/widgets/pull/12",
      state: "OPEN",
      isDraft: true,
      author: { login: "octocat" },
      assignees: { nodes: [{ login: "alice" }, {}] },
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      statusCheckRollup: {
        state: "SUCCESS",
        contexts: { nodes: [{ __typename: "CheckRun", conclusion: "SUCCESS" }] },
      },
      reviewThreads: { nodes: [{ isResolved: false }] },
      reviewRequests: { nodes: [
        { requestedReviewer: { login: "bob" } },
        { requestedReviewer: { slug: "frontend" } },
      ] },
      latestReviews: { nodes: [{ author: { login: "carol" }, state: "APPROVED" }] },
    })

    expect(pr).toMatchObject({
      number: 12,
      title: "Update widgets",
      isDraft: true,
      authorLogin: "octocat",
      assigneeLogins: ["alice"],
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      checkStatuses: ["SUCCESS"],
      reviewThreads: [{ isResolved: false }],
      reviewRequests: [{ type: "user", login: "bob" }, { type: "team", slug: "frontend" }],
      latestReviews: [{ author: { login: "carol" }, state: "APPROVED" }],
    })
  })

  test("treats malformed external payloads as absent optional data", () => {
    expect(mapPullFromGraphQL(null)).toMatchObject({
      number: 0,
      title: "",
      url: "",
      isDraft: false,
      mergeStateStatus: "UNKNOWN",
      reviewDecision: "UNKNOWN",
      assigneeLogins: [],
      checkStatuses: null,
      reviewThreads: null,
      reviewRequests: [],
      latestReviews: [],
    })
  })
})
