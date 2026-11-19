/** @jsxImportSource @opentui/solid */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clearOctokitMocks, installOctokitMock, mockOctokitOp } from "../helpers/octokit-mock"
import { makeFakeRepo } from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { createDashboard } from "../helpers/dashboard-fixture"

// Serve open and closed listings separately, recording which were asked for.
function mockListings(requested: string[][], delayMs = 0) {
  mockOctokitOp("graphql", async (params) => {
    const states: string[] = params?.params?.states ?? []
    requested.push(states)
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const closed = states.includes("CLOSED")
    return {
      viewer: { login: "octocat" },
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: false },
          nodes: closed
            ? [{ number: 2, title: "Merged PR", state: "MERGED", author: { login: "octocat" } }]
            : [{ number: 1, title: "Open PR", state: "OPEN", author: { login: "octocat" } }],
        },
      },
    }
  })
}

async function inRepo(fn: () => Promise<void>) {
  const origCwd = process.cwd()
  process.chdir(makeFakeRepo())
  try {
    await fn()
  } finally {
    process.chdir(origCwd)
  }
}

describe("useDashboard open-first loading", () => {
  beforeEach(() => installOctokitMock())
  afterEach(() => clearOctokitMocks())

  test("loads only open PRs while the status filter is open", () =>
    inRepo(async () => {
      const requested: string[][] = []
      mockListings(requested)
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)
      await refresh()

      expect(requested).toEqual([["OPEN"]])
      expect(state().prs.map((pr) => pr.number)).toEqual([1])
      expect(state().closedLoaded).toBe(false)
    }))

  test("loads closed PRs when a filter needs them and keeps them afterwards", () =>
    inRepo(async () => {
      const requested: string[][] = []
      mockListings(requested)
      let includeClosed = false
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, () => includeClosed)
      await refresh()

      includeClosed = true
      await refresh()
      expect(requested.slice(1)).toEqual([["OPEN"], ["CLOSED", "MERGED"]])
      expect(state().prs.map((pr) => pr.number)).toEqual([1, 2])
      expect(state().closedLoaded).toBe(true)

      // Back on the open filter, refreshes skip closed PRs but keep the
      // cached ones for the next switch.
      includeClosed = false
      requested.length = 0
      await refresh()
      expect(requested).toEqual([["OPEN"]])
      expect(state().prs.map((pr) => pr.number)).toEqual([1, 2])
      expect(state().closedLoaded).toBe(true)
    }))

  test("a closed filter chosen mid-refresh gets its closed PRs", () =>
    inRepo(async () => {
      const requested: string[][] = []
      mockListings(requested, 20)
      let includeClosed = false
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, () => includeClosed)

      // The initial open-only refresh is still in flight.
      includeClosed = true
      await refresh()

      expect(requested).toContainEqual(["CLOSED", "MERGED"])
      expect(state().closedLoaded).toBe(true)
      expect(state().prs.map((pr) => pr.number)).toEqual([1, 2])
    }))
})
