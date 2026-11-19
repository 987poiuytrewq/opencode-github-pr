/** @jsxImportSource @opentui/solid */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { installOctokitMock, mockOctokitDefault, clearOctokitMocks } from "../helpers/octokit-mock"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  makeFakeRepo,
  makeSearchResponse,
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
          if (query.includes("pullRequests(")) return makeSearchResponse(2)
          return makeThreadCountResponse().data
        }
        if (op === "pulls.get") {
          const node = makeSearchResponse(1).repository.pullRequests.nodes[0]
          return { data: node }
        }
        return null
      })

      const { api } = createMockTuiApi()
      // A TUI can have a plugin location different from the active session's
      // project, and its session cache may not be warm during plugin setup.
      ;(api as any).location = { directory: origCwd }
      ;(api as any).data.session.get = () => undefined
      ;(api as any).client.session.get = async (input: { sessionID: string }) => ({
        id: input.sessionID,
        location: { directory: cwd },
      })
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
      expect(state().viewerLogin).toBe("octocat")
      expect(state().currentBranch).toBe("main")
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
    const cwd = mkdtempSync(join(tmpdir(), "pr-dash-no-repo-"))
    const origCwd = process.cwd()
    process.chdir(cwd)
    const { api } = createMockTuiApi()
    try {
      const { state } = createDashboard(api)

      for (let i = 0; i < 50; i++) {
        if (state().status === DashboardStatus.NoRepo) break
        await new Promise((r) => setTimeout(r, 10))
      }

      expect(state().status).toBe(DashboardStatus.NoRepo)
    } finally {
      process.chdir(origCwd)
      rmSync(cwd, { recursive: true, force: true })
    }
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
