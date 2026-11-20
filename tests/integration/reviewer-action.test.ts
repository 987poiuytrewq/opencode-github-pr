import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createActions } from "../../plugins/app/actions"
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitOp,
} from "../helpers/octokit-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { okState } from "../helpers/state-fixtures"

beforeEach(() => {
  clearOctokitMocks()
  installOctokitMock()
})

afterEach(() => {
  clearOctokitMocks()
})

function actionFixture() {
  const { api, registry } = createMockTuiApi()
  const state = okState()
  const actions = createActions(api, {
    state: () => state,
    refresh: async () => {},
    loadMore: async () => {},
    refreshOne: async () => {},
    selectedIdx: () => 0,
    setSelectedIdx: () => {},
  })
  return { actions, registry, pr: state.prs[0] }
}

describe("requestReviewer action", () => {
  test("sends a user login in the reviewers field", async () => {
    const { actions, registry, pr } = actionFixture()
    let requested: any
    mockOctokitOp("pulls.requestReviewers", async (params) => {
      requested = params
      return { data: {} }
    })

    await actions.requestReviewer(pr.number, "octocat")

    expect(requested).toEqual({
      owner: "foo",
      repo: "bar",
      pull_number: pr.number,
      reviewers: ["octocat"],
    })
    expect(registry.toasts.at(-1).message).toContain("@octocat")
  })

  test("sends an organization team slug in team_reviewers", async () => {
    const { actions, registry, pr } = actionFixture()
    let requested: any
    mockOctokitOp("pulls.requestReviewers", async (params) => {
      requested = params
      return { data: {} }
    })

    await actions.requestReviewer(pr.number, "@foo/design-team")

    expect(requested).toEqual({
      owner: "foo",
      repo: "bar",
      pull_number: pr.number,
      team_reviewers: ["design-team"],
    })
    expect(registry.toasts.at(-1).message).toContain("foo/design-team")
  })

  test("rejects invalid input before calling GitHub", async () => {
    const { actions, registry, pr } = actionFixture()
    let requestCount = 0
    mockOctokitOp("pulls.requestReviewers", async () => {
      requestCount++
      return { data: {} }
    })

    await actions.requestReviewer(pr.number, "other-org/team")

    expect(requestCount).toBe(0)
    expect(registry.toasts.at(-1)).toMatchObject({ variant: "error" })
    expect(registry.toasts.at(-1).message).toContain("foo/team-slug")
  })

  test("surfaces GitHub API status and error details", async () => {
    const { actions, registry, pr } = actionFixture()
    mockOctokitOp("pulls.requestReviewers", async () => {
      throw Object.assign(
        new Error("Validation Failed: reviewer is not a collaborator"),
        { status: 422 },
      )
    })

    await actions.requestReviewer(pr.number, "octocat")

    expect(registry.toasts.at(-1)).toMatchObject({ variant: "error" })
    expect(registry.toasts.at(-1).message).toContain("HTTP 422")
    expect(registry.toasts.at(-1).message).toContain(
      "reviewer is not a collaborator",
    )
  })

  test("prompts when no reviewer argument is provided and does nothing on cancel", async () => {
    const { actions, registry } = actionFixture()
    registry.promptValue = undefined
    let requestCount = 0
    mockOctokitOp("pulls.requestReviewers", async () => {
      requestCount++
      return { data: {} }
    })

    await actions.requestReviewer(1)

    expect(requestCount).toBe(0)
    expect(registry.toasts).toHaveLength(0)
  })
})
