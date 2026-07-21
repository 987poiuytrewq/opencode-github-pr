/** @jsxImportSource @opentui/solid */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { installOctokitMock, mockOctokitDefault, clearOctokitMocks } from "../helpers/octokit-mock"
import {
  makeFakeRepo,
  makeSearchResponse,
  makeBranchProtectionResponse,
  makeThreadCountResponse,
} from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { createDashboard } from "../helpers/dashboard-fixture"
import { DashboardStatus } from "../../plugins/domain/types"

describe("useDashboard initialization", () => {
  beforeEach(() => {
    installOctokitMock()
  })

  afterEach(() => {
    clearOctokitMocks()
  })

  test("transitions from loading to ok when refresh() succeeds", async () => {
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
        if (op === "repos.getBranchProtection") return makeBranchProtectionResponse()
        if (op === "pulls.get") {
          const node = makeSearchResponse(1).search.nodes[0]
          return { data: node }
        }
        return null
      })

      const { api } = createMockTuiApi()
      const { state } = createDashboard(api)

      const r = await testRender(
        () => (
          <box flexDirection="column">
            <text>{`status=${state().status}`}</text>
            <text>{`prCount=${state().prs.length}`}</text>
          </box>
        ),
        { width: 80, height: 10 },
      )

      for (let i = 0; i < 50; i++) {
        if (state().status === DashboardStatus.Ok) break
        await new Promise((r) => setTimeout(r, 10))
      }
      await r.flush()
      const frame = r.captureCharFrame()

      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().prs.length).toBe(2)
      expect(frame).toContain("status=ok")
      expect(frame).toContain("prCount=2")
    } finally {
      process.chdir(origCwd)
    }
  })

  test("transitions to error when fetchPRs throws", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      mockOctokitDefault((op) => {
        if (op === "graphql") {
          throw new Error("Network unreachable")
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
      expect(state().error).toContain("Network unreachable")
    } finally {
      process.chdir(origCwd)
    }
  })

  test("transitions to no-repo when detectRepo returns null", async () => {
    const { api } = createMockTuiApi()
    const { state } = createDashboard(api)

    for (let i = 0; i < 50; i++) {
      if (state().status === DashboardStatus.NoRepo) break
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(state().status).toBe(DashboardStatus.NoRepo)
  })

  test("transitions to error on timeout when fetchPRs hangs", async () => {
    const cwd = makeFakeRepo()
    const origCwd = process.cwd()
    process.chdir(cwd)
    try {
      mockOctokitDefault((op) => {
        if (op === "graphql") {
          return new Promise(() => {})
        }
        return null
      })

      const { api } = createMockTuiApi()
      const { state } = createDashboard(api)

      for (let i = 0; i < 1700; i++) {
        if (state().status === DashboardStatus.Error) break
        await new Promise((r) => setTimeout(r, 10))
      }

      expect(state().status).toBe(DashboardStatus.Error)
      expect(state().error).toMatch(/timed out/i)
    } finally {
      process.chdir(origCwd)
    }
  }, 20_000)
})
