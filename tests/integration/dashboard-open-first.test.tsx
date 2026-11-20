/** @jsxImportSource @opentui/solid */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clearOctokitMocks, installOctokitMock, mockOctokitOp } from "../helpers/octokit-mock"
import { makeFakeRepo } from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { createDashboard } from "../helpers/dashboard-fixture"

// Serve one status-filtered listing at a time, recording which was asked for.
function mockListings(requested: string[][], delayMs = 0) {
  mockOctokitOp("graphql", async (params) => {
    const states: string[] = params?.params?.states ?? []
    requested.push(states)
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const open = states.includes("OPEN")
    const closed = states.includes("CLOSED") || states.includes("MERGED")
    const nodes = []
    if (open) nodes.push({ number: 1, title: "Open PR", state: "OPEN", author: { login: "octocat" } })
    if (closed) nodes.push({ number: 2, title: "Merged PR", state: "MERGED", author: { login: "octocat" } })
    return {
      viewer: { login: "octocat" },
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: false },
          nodes,
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
      expect(state().pagination.listing).toBe("open")
    }))

  test("requests closed and all status filters directly from GitHub", () =>
    inRepo(async () => {
      const requested: string[][] = []
      mockListings(requested)
      let status: "open" | "closed" | "all" = "open"
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, () => status)
      await refresh()

      status = "closed"
      await refresh()
      expect(requested).toEqual([["OPEN"], ["CLOSED", "MERGED"]])
      expect(state().prs.map((pr) => pr.number)).toEqual([2])

      status = "all"
      await refresh()
      expect(requested.at(-1)).toEqual(["OPEN", "CLOSED", "MERGED"])
      expect(state().prs.map((pr) => pr.number)).toEqual([1, 2])
      expect(state().pagination.listing).toBe("all")
    }))

  test("refreshes and requests the current branch scope from GitHub", () =>
    inRepo(async () => {
      let captured: any = null
      mockOctokitOp("graphql", (params) => {
        captured = params
        return {
          viewer: { login: "octocat" },
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false },
              nodes: [{ number: 3, title: "Main PR", state: "OPEN", headRefName: "main" }],
            },
          },
        }
      })
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, () => "open", () => "branch")
      await refresh()

      expect(captured.params.head).toBe("main")
      expect(state().pagination.scope).toBe("branch")
      expect(state().pagination.scopeValue).toBe("main")
      expect(state().prs.map((pr) => pr.number)).toEqual([3])
    }))

  test("scales the PR batch with the configured TUI page size", () =>
    inRepo(async () => {
      let requestedCount = 0
      mockOctokitOp("graphql", (params) => {
        requestedCount = params?.params?.first ?? 0
        return {
          viewer: { login: "octocat" },
          repository: {
            pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
          },
        }
      })
      const { api } = createMockTuiApi()
      const { refresh } = createDashboard(api, undefined, undefined, 8)
      await refresh()

      expect(requestedCount).toBe(32)
    }))

  test("uses GitHub search for the author scope and updates when the scope changes", () =>
    inRepo(async () => {
      const queries: string[] = []
      mockOctokitOp("graphql", (params) => {
        const query = params?.params?.query
        if (typeof query === "string") {
          queries.push(query)
          return {
            viewer: { login: "octocat" },
            search: {
              pageInfo: { hasNextPage: false },
              nodes: [{ number: 4, title: "My PR", state: "OPEN", author: { login: "octocat" } }],
            },
          }
        }
        return {
          viewer: { login: "octocat" },
          repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] } },
        }
      })
      let scope: "author" | "assignee" = "author"
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, () => "open", () => scope)
      await refresh()
      expect(queries[0]).toContain("author:@me")

      scope = "assignee"
      await refresh()
      expect(queries[1]).toContain("assignee:@me")
      expect(state().pagination.scope).toBe("assignee")
      expect(state().prs.map((pr) => pr.number)).toEqual([4])
    }))

  test("a closed filter chosen mid-refresh gets its closed PRs", () =>
    inRepo(async () => {
      const requested: string[][] = []
      mockListings(requested, 20)
      let status: "open" | "closed" | "all" = "open"
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, () => status)

      // The initial open-only refresh is still in flight.
      status = "closed"
      await refresh()

      expect(requested).toContainEqual(["CLOSED", "MERGED"])
      expect(state().pagination.listing).toBe("closed")
      expect(state().prs.map((pr) => pr.number)).toEqual([2])
    }))

  test("loads four TUI pages of PRs per batch and continues from the cursor", () =>
    inRepo(async () => {
      const afters: Array<string | null> = []
      const firsts: number[] = []
      mockOctokitOp("graphql", (params) => {
        const after = params?.params?.after ?? null
        const first = params?.params?.first ?? 0
        afters.push(after)
        firsts.push(first)
        const start = after ? Number(after.replace("cursor-", "")) + 1 : 1
        const end = start + first - 1
        return {
          viewer: { login: "octocat" },
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: end < 60, endCursor: `cursor-${end}` },
              nodes: Array.from({ length: first }, (_, i) => ({
                number: start + i,
                title: `PR ${start + i}`,
                state: "OPEN",
                author: { login: "octocat" },
              })),
            },
          },
        }
      })
      const { api } = createMockTuiApi()
      const { state, refresh, loadMore } = createDashboard(api)
      await refresh()

      expect(state().pagination.pagesLoaded).toBe(1)
      expect(state().prs).toHaveLength(20)
      expect(state().prs[0].number).toBe(1)
      expect(state().prs.at(-1)?.number).toBe(20)
      await loadMore()

      expect(afters).toEqual([null, "cursor-20"])
      expect(firsts).toEqual([20, 20])
      expect(state().pagination.pagesLoaded).toBe(2)
      expect(state().prs).toHaveLength(40)
      expect(state().prs.at(-1)?.number).toBe(40)
    }))
})
