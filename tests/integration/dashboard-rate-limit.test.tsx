/** @jsxImportSource @opentui/solid */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  installOctokitMock,
  mockOctokitDefault,
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

describe("useDashboard rate limit handling", () => {
  beforeEach(() => {
    installOctokitMock()
  })

  afterEach(() => {
    clearOctokitMocks()
  })

  test("shows friendly rate limit message with reset time from x-ratelimit-reset header", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      const resetEpoch = Math.floor(Date.now() / 1000) + 3600
      const expectedResetText = new Date(resetEpoch * 1000).toLocaleTimeString()
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
          if (query.includes("search(")) {
            const err: any = new Error(
              "Request failed due to following response errors: - API rate limit already exceeded for user ID 12345.",
            )
            err.status = 200
            err.response = { headers: { "x-ratelimit-reset": String(resetEpoch) } }
            throw err
          }
          return makeThreadCountResponse()
        }
        return null
      })

      const { api } = createMockTuiApi()
      const { state } = createDashboard(api)

      for (let i = 0; i < 50; i++) {
        if (state().status === DashboardStatus.Error) break
        await new Promise((r) => setTimeout(r, 10))
      }

      expect(state().status).toBe(DashboardStatus.Error)
      expect(state().error).toContain("rate limit")
      expect(state().error).toContain("resets at")
      expect(state().error).toContain(expectedResetText)
    } finally {
      process.chdir(origCwd)
    }
  })

  test("falls back to 'unknown time' when rate limit error has no reset header", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
          if (query.includes("search(")) {
            const err: any = new Error("API rate limit exceeded for installation ID 99999")
            err.status = 403
            err.response = { headers: {} }
            throw err
          }
          return makeThreadCountResponse()
        }
        return null
      })

      const { api } = createMockTuiApi()
      const { state } = createDashboard(api)

      for (let i = 0; i < 50; i++) {
        if (state().status === DashboardStatus.Error) break
        await new Promise((r) => setTimeout(r, 10))
      }

      expect(state().status).toBe(DashboardStatus.Error)
      expect(state().error).toContain("rate limit")
      expect(state().error).toContain("unknown time")
    } finally {
      process.chdir(origCwd)
    }
  })

  test("a successful first refresh then a rate-limited refresh preserves the existing PR list", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      let callIndex = 0
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
          if (query.includes("search(")) {
            callIndex++
            if (callIndex === 1) return makeSearchResponse(3)
            // Second call: rate limited.
            const err: any = new Error("API rate limit already exceeded for user ID 12345")
            err.status = 200
            err.response = { headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60) } }
            throw err
          }
          return makeThreadCountResponse()
        }
        return null
      })

      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)

      // Wait for the first (successful) refresh.
      for (let i = 0; i < 50; i++) {
        if (state().status === DashboardStatus.Ok) break
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().prs.length).toBe(3)

      // Second refresh: should be rate-limited, but preserve the existing PR list.
      await refresh()
      expect(state().status).toBe(DashboardStatus.Error)
      expect(state().error).toContain("rate limit")
      expect(state().prs.length).toBe(3)
    } finally {
      process.chdir(origCwd)
    }
  })

  test("non-rate-limit errors still clear the PR list", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      let callIndex = 0
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
          if (query.includes("search(")) {
            callIndex++
            if (callIndex === 1) return makeSearchResponse(2)
            throw new Error("Network unreachable")
          }
          return makeThreadCountResponse()
        }
        return null
      })

      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)

      for (let i = 0; i < 50; i++) {
        if (state().status === DashboardStatus.Ok) break
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().prs.length).toBe(2)

      await refresh()
      expect(state().status).toBe(DashboardStatus.Error)
      expect(state().error).toContain("Network unreachable")
      expect(state().prs.length).toBe(0)
    } finally {
      process.chdir(origCwd)
    }
  })
})
