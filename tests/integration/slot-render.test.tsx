/** @jsxImportSource @opentui/solid */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { installOctokitMock, mockOctokitDefault, clearOctokitMocks } from "../helpers/octokit-mock"
import { makeFakeRepo, makeSearchResponse, makeThreadCountResponse } from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { DashboardStatus } from "../../plugins/domain/types"

const plugin_mod = await import("../../plugins/pr-dashboard.tui")
const plugin = plugin_mod.default as { id: string; tui: any }

describe("slot render: sidebar_content produces visible output", () => {
  beforeEach(() => {
    installOctokitMock()
  })

  afterEach(() => {
    clearOctokitMocks()
  })

  test("slot renders PRs header with data", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
          if (query.includes("pullRequests(")) return makeSearchResponse(2)
          return makeThreadCountResponse().data
        }
        return null
      })

      const { api, registry } = createMockTuiApi()
      await plugin.tui(api, {})

      expect(registry.slots.length).toBe(1)
      const slotFn = registry.slots[0].slots.sidebar_content
      expect(typeof slotFn).toBe("function")

      const ctx = { theme: api.theme }
      const props = { session_id: "test-session" }

      const r = await testRender(
        () => slotFn(ctx, props),
        { width: 50, height: 20 },
      )

      await r.flush()
      const frame = r.captureCharFrame()
      expect(frame).toContain("PRs")
    } finally {
      process.chdir(origCwd)
    }
  })

  test("slot renders PRs header even with NoRepo", async () => {
    const { api, registry } = createMockTuiApi()
    await plugin.tui(api, {})

    const slotFn = registry.slots[0].slots.sidebar_content
    const ctx = { theme: api.theme }
    const props = { session_id: "test-session" }

    const r = await testRender(
      () => slotFn(ctx, props),
      { width: 50, height: 20 },
    )
    await r.flush()
    const frame = r.captureCharFrame()
    expect(frame).toContain("PRs")
  })

  test("slot renders filter label", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("query Viewer")) return { viewer: { login: "octocat" } }
          if (query.includes("pullRequests(")) return makeSearchResponse(1)
          return makeThreadCountResponse().data
        }
        return null
      })

      const { api, registry } = createMockTuiApi()
      await plugin.tui(api, {})

      const slotFn = registry.slots[0].slots.sidebar_content
      const ctx = { theme: api.theme }
      const props = { session_id: "test-session" }

      const r = await testRender(
        () => slotFn(ctx, props),
        { width: 50, height: 20 },
      )
      await r.flush()
      const frame = r.captureCharFrame()
      expect(frame).toContain("author:@me")
    } finally {
      process.chdir(origCwd)
    }
  })
})
