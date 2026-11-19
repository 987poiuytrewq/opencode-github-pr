/** @jsxImportSource @opentui/solid */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { installOctokitMock, mockOctokitDefault, clearOctokitMocks } from "../helpers/octokit-mock"
import { makeFakeRepo, makeSearchResponse, makeThreadCountResponse } from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { DashboardStatus } from "../../plugins/domain/types"

const plugin_mod = await import("../../plugins/pr-dashboard.tui")
const plugin = plugin_mod.default

describe("slot render: sidebar_content produces visible output", () => {
  beforeEach(() => {
    installOctokitMock()
  })

  afterEach(() => {
    clearOctokitMocks()
  })

  test("slot renders Pull Requests header with current branch data", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("search(")) return makeSearchResponse(2)
          return makeThreadCountResponse().data
        }
        return null
      })

      const { api, registry } = createMockTuiApi()
      const cleanup = await plugin.setup(api)

      expect(registry.slots.some((slot) => slot.append === "sidebar.content")).toBe(true)
      expect(registry.slots[0].append).toBe("sidebar.content")
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
      expect(frame).toContain("Pull Requests")
      cleanup?.()
    } finally {
      process.chdir(origCwd)
    }
  })

  test("slot renders Pull Requests header even with NoRepo", async () => {
    const { api, registry } = createMockTuiApi()
    const cleanup = await plugin.setup(api)

    const slotFn = registry.slots[0].slots.sidebar_content
    const ctx = { theme: api.theme }
    const props = { session_id: "test-session" }

    const r = await testRender(
      () => slotFn(ctx, props),
      { width: 50, height: 20 },
    )
    await r.flush()
    const frame = r.captureCharFrame()
    expect(frame).toContain("Pull Requests")
    cleanup?.()
  })

  test("slot does not render a filter label", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      mockOctokitDefault((op, params) => {
        if (op === "graphql") {
          const query: string = params?.query ?? ""
          if (query.includes("search(")) return makeSearchResponse(1)
          return makeThreadCountResponse().data
        }
        return null
      })

      const { api, registry } = createMockTuiApi()
      const cleanup = await plugin.setup(api)

      const slotFn = registry.slots[0].slots.sidebar_content
      const ctx = { theme: api.theme }
      const props = { session_id: "test-session" }

      const r = await testRender(
        () => slotFn(ctx, props),
        { width: 50, height: 20 },
      )
      await r.flush()
      const frame = r.captureCharFrame()
      expect(frame).not.toContain("author:@me")
      cleanup?.()
    } finally {
      process.chdir(origCwd)
    }
  })
})
