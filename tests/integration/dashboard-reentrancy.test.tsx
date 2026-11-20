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
import { DashboardStatus } from "../../plugins/domain/types"

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

  test("a slow first refresh that errors does not clobber a fast successful second refresh", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      let callIndex = 0
      // First PR-search call hangs forever (will time out). Once it times
      // out, the reentrancy guard releases and any subsequent refresh sees
      // a fresh attempt. We then verify that the second refresh succeeds and
      // lands the state in "ok".
      mockOctokitOp("graphql", async (params) => {
        const query: string = params?.query ?? ""
        if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
        if (query.includes("pullRequests(")) {
          callIndex++
          if (callIndex === 1) return new Promise(() => {})
          return makeSearchResponse(1)
        }
        return makeThreadCountResponse()
      })
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)

      // Wait for the first refresh to time out. timeoutRace is 15s; with
      // a tick or two of buffer, the in-flight promise resolves with error.
      for (let i = 0; i < 1700; i++) {
        if (state().status === DashboardStatus.Error) break
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(state().status).toBe(DashboardStatus.Error)

      // Now a fresh refresh should run (call #2) and succeed.
      await refresh()
      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().prs.length).toBe(1)
    } finally {
      process.chdir(origCwd)
    }
  }, 25_000)
})
