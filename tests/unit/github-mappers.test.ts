import { describe, expect, test } from "bun:test"
import { mapPullFromGraphQL, mapPullFromREST } from "../../plugins/infra/mappers"

describe("GitHub response mappers", () => {
  test("maps expected GraphQL fields into the PR domain shape", () => {
    const pr = mapPullFromGraphQL({
      number: 12,
      title: "Update widgets",
      url: "https://github.com/acme/widgets/pull/12",
      state: "OPEN",
      isDraft: true,
      author: { login: "octocat" },
      assignees: { nodes: [{ login: "alice" }, {}] },
      statusCheckRollup: {
        state: "SUCCESS",
        contexts: { nodes: [{ __typename: "CheckRun", conclusion: "SUCCESS" }] },
      },
      reviewThreads: { nodes: [{ isResolved: false }] },
      reviewRequests: { nodes: [{ requestedReviewer: { login: "bob" } }] },
      latestReviews: { nodes: [{ author: { login: "carol" }, state: "APPROVED" }] },
    })

    expect(pr).toMatchObject({
      number: 12,
      title: "Update widgets",
      isDraft: true,
      authorLogin: "octocat",
      assigneeLogins: ["alice"],
      checkStatuses: ["SUCCESS"],
      reviewThreads: [{ isResolved: false }],
      reviewRequests: [{ login: "bob" }],
      latestReviews: [{ author: { login: "carol" }, state: "APPROVED" }],
    })
  })

  test("treats malformed external payloads as absent optional data", () => {
    expect(mapPullFromGraphQL(null)).toMatchObject({
      number: 0,
      title: "",
      url: "",
      isDraft: false,
      assigneeLogins: [],
      checkStatuses: null,
      reviewThreads: null,
      reviewRequests: [],
      latestReviews: [],
    })
    expect(mapPullFromREST({ assignees: [null, {}], requested_reviewers: [null] })).toMatchObject({
      number: 0,
      baseRefName: "",
      assigneeLogins: [],
      reviewRequests: [],
      latestReviews: [],
    })
  })
})
