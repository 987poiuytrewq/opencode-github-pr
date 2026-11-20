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
          if (query.includes("pullRequests(")) {
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
          if (query.includes("pullRequests(")) {
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
          if (query.includes("pullRequests(")) {
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

  test("filter changes during cooldown keep the cached list and rate-limit state visible", async () => {
    const cwd = makeFakeRepo()
    const originalCwd = process.cwd()
    process.chdir(cwd)
    try {
      let listing: "open" | "closed" = "open"
      let pullRequestCalls = 0
      mockOctokitDefault((op, params) => {
        if (op !== "graphql") return null
        const query: string = params?.query ?? ""
        if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
        if (query.includes("pullRequests(")) {
          pullRequestCalls++
          if (pullRequestCalls === 1) return makeSearchResponse(3)
          const err: any = new Error("API rate limit already exceeded")
          err.status = 200
          err.response = {
            headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60) },
          }
          throw err
        }
        return makeThreadCountResponse()
      })

      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, () => listing)
      for (let i = 0; i < 50 && state().status !== DashboardStatus.Ok; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(state().prs).toHaveLength(3)

      await refresh()
      expect(state().errorKind).toBe("rate-limit")
      expect(pullRequestCalls).toBe(2)

      listing = "closed"
      await refresh()

      expect(pullRequestCalls).toBe(2)
      expect(state().status).toBe(DashboardStatus.Error)
      expect(state().pagination.listing).toBe("closed")
      expect(state().pagination.loading).toBe(false)
      expect(state().errorKind).toBe("rate-limit")
      expect(state().prs).toHaveLength(3)
    } finally {
      process.chdir(originalCwd)
    }
  })

  test("secondary Retry-After suppresses refresh requests until its cooldown expires", async () => {
    const cwd = makeFakeRepo()
    const originalCwd = process.cwd()
    const originalNow = Date.now
    let pullRequestCalls = 0
    process.chdir(cwd)
    try {
      mockOctokitDefault((op, params) => {
        if (op !== "graphql") return null
        const query: string = params?.query ?? ""
        if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
        if (query.includes("pullRequests(")) {
          pullRequestCalls++
          const err: any = new Error("You have exceeded a secondary rate limit")
          err.status = 429
          err.response = { headers: { "retry-after": "30" } }
          throw err
        }
        return makeThreadCountResponse()
      })

      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)
      for (let i = 0; i < 50 && state().status !== DashboardStatus.Error; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(state().errorKind).toBe("rate-limit")
      expect(pullRequestCalls).toBe(1)

      await refresh()
      expect(pullRequestCalls).toBe(1)

      Date.now = () => originalNow() + 33_000
      await refresh()
      expect(pullRequestCalls).toBe(2)
    } finally {
      Date.now = originalNow
      process.chdir(originalCwd)
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
          if (query.includes("pullRequests(")) {
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

describe("manual PR refresh rate-limit toast", () => {
  test("reports the reset time when /pr-refresh is suppressed", async () => {
    const cwd = makeFakeRepo()
    const originalCwd = process.cwd()
    let cleanup: (() => void) | undefined
    process.chdir(cwd)
    try {
      mockOctokitDefault((op, params) => {
        if (op !== "graphql") return null
        const query: string = params?.query ?? ""
        if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
        if (query.includes("pullRequests(")) {
          const resetEpoch = Math.floor(Date.now() / 1000) + 60
          const err: any = new Error("API rate limit already exceeded")
          err.status = 200
          err.response = { headers: { "x-ratelimit-reset": String(resetEpoch) } }
          throw err
        }
        return makeThreadCountResponse()
      })

      const { default: plugin } = await import("../../plugins/pr-dashboard.tui")
      const { api, registry } = createMockTuiApi()
      const dispose = await plugin.setup(api)
      if (typeof dispose === "function") cleanup = dispose
      const appSlot = registry.slots.find((slot) => slot.append === "app")
      appSlot.render({})
      const refreshCommand = registry.keymaps[0].commands.find(
        (command: any) => command.id === "opencode-github-pr.refresh",
      )

      await new Promise((resolve) => setTimeout(resolve, 50))
      await refreshCommand.run()
      for (let i = 0; i < 50 && registry.toasts.length < 1; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      expect(registry.toasts.at(-1)?.message).toContain("PR refresh paused")
      expect(registry.toasts.at(-1)?.message).toContain("resets at")
      await refreshCommand.run()
      for (let i = 0; i < 50 && registry.toasts.length < 2; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(registry.toasts.at(-1)?.message).toContain("PR refresh paused")
      expect(registry.toasts.at(-1)?.message).toContain("resets at")
    } finally {
      cleanup?.()
      process.chdir(originalCwd)
    }
  })
})
