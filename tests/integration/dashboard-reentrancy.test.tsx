/** @jsxImportSource @opentui/solid */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  installOctokitMock,
  mockOctokitOp,
  clearOctokitMocks,
} from "../helpers/octokit-mock"
import {
  makeFakeRepo,
  makeSearchResponse,
  makeThreadCountResponse,
} from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { createDashboard } from "../helpers/dashboard-fixture"
import { createSignal } from "solid-js"
import { DashboardStatus, type DashboardState } from "../../plugins/domain/types"
import { useDashboard } from "../../plugins/app/usePRData"

describe("useDashboard reentrancy and cancellation", () => {
  beforeEach(() => {
    installOctokitMock()
  })

  afterEach(() => {
    clearOctokitMocks()
  })

  test("concurrent refresh() calls share one network round-trip (reentrancy guard)", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      let searchCalls = 0
      // Slow PR search so the first refresh is still in flight when the
      // second call lands.
      mockOctokitOp("graphql", async (params) => {
        const query: string = params?.query ?? ""
        if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
        if (query.includes("pullRequests(")) {
          searchCalls++
          await new Promise((r) => setTimeout(r, 50))
          return makeSearchResponse(2)
        }
        return makeThreadCountResponse()
      })
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)

      // Two concurrent refresh calls. With the guard, the second call should
      // return the in-flight promise rather than starting another network op.
      const p1 = refresh()
      const p2 = refresh()
      await Promise.all([p1, p2])

      expect(searchCalls).toBe(1)
      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().prs.length).toBe(2)
    } finally {
      process.chdir(origCwd)
    }
  })

  test("a per-request timeout does not clobber a successful subsequent refresh", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      let callIndex = 0
      mockOctokitOp("graphql", async (params) => {
        const query: string = params?.query ?? ""
        if (query.includes("pullRequests(")) {
          callIndex++
          if (callIndex === 1) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            throw Object.assign(new Error("Request timed out"), { status: 408 })
          }
          return makeSearchResponse(1)
        }
        return makeThreadCountResponse()
      })
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)

      for (let i = 0; i < 50 && state().status !== DashboardStatus.Error; i++) {
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(state().status).toBe(DashboardStatus.Error)

      await refresh()
      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().prs.length).toBe(1)
      expect(callIndex).toBe(2)
    } finally {
      process.chdir(origCwd)
    }
  })

  test("a multi-page batch can exceed the per-request timeout in aggregate", async () => {
    const cwd = makeFakeRepo()
    const originalCwd = process.cwd()
    process.chdir(cwd)
    try {
      let pageCalls = 0
      const requestDurations: number[] = []
      mockOctokitOp("graphql", async (request) => {
        const query: string = request?.query ?? ""
        if (!query.includes("pullRequests(")) return makeThreadCountResponse()

        pageCalls++
        const startedAt = Date.now()
        await new Promise((resolve) => setTimeout(resolve, 3_900))
        requestDurations.push(Date.now() - startedAt)
        const response: any = makeSearchResponse(1)
        response.repository.pullRequests.nodes[0].number = pageCalls
        response.repository.pullRequests.pageInfo = {
          hasNextPage: pageCalls < 4,
          endCursor: `cursor-${pageCalls}`,
        }
        return response
      })

      const { api } = createMockTuiApi()
      const [state, setState] = createSignal<DashboardState>({
        status: DashboardStatus.Loading,
        repo: null,
        prs: [],
        currentBranch: null,
        viewerLogin: null,
        fetchedAt: null,
        pagination: {
          listing: "open",
          scope: "all",
          scopeValue: null,
          cursor: null,
          hasMore: false,
          totalCount: null,
          pagesLoaded: 0,
          searchResultsFetched: 0,
          supplementalPRCount: 0,
          loading: false,
          limitReached: false,
        },
      })
      const dashboard = useDashboard(api, state, setState, 15_000, 4, () => "open", () => "all", 1)
      const startedAt = Date.now()
      await dashboard.refresh()

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15_000)
      expect(requestDurations).toHaveLength(4)
      expect(requestDurations.every((duration) => duration < 15_000)).toBe(true)
      expect(pageCalls).toBe(4)
      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().prs.map((pr) => pr.number)).toEqual([1, 2, 3, 4])
      expect(state().pagination.pagesLoaded).toBe(4)
    } finally {
      process.chdir(originalCwd)
    }
  }, 20_000)
})
