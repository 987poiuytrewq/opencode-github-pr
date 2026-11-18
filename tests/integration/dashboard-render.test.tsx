/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { DashboardState } from "../../plugins/domain/types"
import { DashboardView } from "../../plugins/app/DashboardView"
import { makeTUIPR } from "../helpers/tui-fixtures"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { loadingState, okState, noRepoState, errorState } from "../helpers/state-fixtures"
import type { PRLinkTarget } from "../../plugins/domain/types"

async function renderState(state: DashboardState, expanded = true, handlers: Partial<{
  onToggleExpand: () => void
  onOpen: (n: number, target?: PRLinkTarget) => void
}> = {}) {
  const { api } = createMockTuiApi()
  return testRender(
    () => (
      <DashboardView
        theme={api.theme}
        state={state}
        onRefresh={() => {}}
        selectedIdx={0}
        setSelectedIdx={() => {}}
        onOpen={handlers.onOpen ?? (() => {})}
        expanded={expanded}
        onToggleExpand={handlers.onToggleExpand ?? (() => {})}
      />
    ),
    { width: 50, height: 20 },
  )
}

describe("DashboardView render", () => {
  test("loading state", async () => {
    const r = await renderState(loadingState())
    await r.flush()
    expect(r.captureCharFrame()).toMatchSnapshot()
  })

  test("ok state with PRs", async () => {
    const r = await renderState(okState())
    await r.flush()
    expect(r.captureCharFrame()).toMatchSnapshot()
  })

  test("no-repo state", async () => {
    const r = await renderState(noRepoState())
    await r.flush()
    expect(r.captureCharFrame()).toMatchSnapshot()
  })

  test("error state", async () => {
    const r = await renderState(errorState())
    await r.flush()
    expect(r.captureCharFrame()).toMatchSnapshot()
  })

  test("collapsed state", async () => {
    const r = await renderState(okState(), false)
    await r.flush()
    expect(r.captureCharFrame()).toMatchSnapshot()
  })

  test("ok state with empty PRs", async () => {
    const r = await renderState(okState({ prs: [] }))
    await r.flush()
    expect(r.captureCharFrame()).toMatchSnapshot()
  })

  test("merged PR uses the merged icon and displays change totals", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        number: 42,
        title: "Merged feature",
        isMerged: true,
        additions: 17,
        deletions: 4,
      })],
    }))
    await r.flush()
    const frame = r.captureCharFrame()
    expect(frame).toContain(" Merged feature")
    expect(frame).toContain("#42 +17 -4")
    expect(frame).toContain("●")
  })

  test("renders review and comment status badges", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        number: 42,
        latestReviews: [{ author: { login: "alice" }, state: "APPROVED" }],
        reviewThreads: [{ isResolved: false }, { isResolved: true }],
      })],
    }))
    await r.flush()
    const frame = r.captureCharFrame()
    expect(frame).toContain("")
    expect(frame).toContain("󰅺1")
    expect(frame).toContain("1")
  })
})

describe("DashboardView mouse interaction", () => {
  test("clicking the header toggles expand", async () => {
    let toggles = 0
    const r = await renderState(okState(), true, {
      onToggleExpand: () => { toggles++ },
    })
    await r.flush()
    // The collapse marker and "Changes" label are at the left of row 1.
    await r.mockMouse.click(4, 1)
    await r.flush()
    expect(toggles).toBe(1)
  })

  test("clicking a PR row opens it", async () => {
    const opened: number[] = []
    const r = await renderState(okState(), true, {
      onOpen: (n) => { opened.push(n) },
    })
    await r.flush()
    // First PR row "#10 Add login flow" is at row 2.
    await r.mockMouse.click(4, 2)
    await r.flush()
    expect(opened).toEqual([10])
  })

  test("clicking the PR number opens the overview without triggering the row click twice", async () => {
    const opened: Array<{ number: number; target?: PRLinkTarget }> = []
    const r = await renderState(okState(), true, {
      onOpen: (number, target) => { opened.push({ number, target }) },
    })
    await r.flush()
    const line = r.captureCharFrame().split("\n").findIndex((row) => row.includes("#10"))
    expect(line).toBeGreaterThanOrEqual(0)
    const x = r.captureCharFrame().split("\n")[line].indexOf("#10")
    await r.mockMouse.click(x, line)
    await r.flush()
    expect(opened).toEqual([{ number: 10, target: "overview" }])
  })

  test("clicking the PR status icon opens the merge status sidebar", async () => {
    const opened: Array<{ number: number; target?: PRLinkTarget }> = []
    const r = await renderState(okState(), true, {
      onOpen: (number, target) => { opened.push({ number, target }) },
    })
    await r.flush()
    await r.mockMouse.click(0, 2)
    await r.flush()
    expect(opened).toEqual([{ number: 10, target: "mergeStatus" }])
  })

  test("status badges open their target pages without triggering the row click", async () => {
    const opened: Array<{ number: number; target?: PRLinkTarget }> = []
    const r = await renderState(okState({
      prs: [makeTUIPR({
        number: 42,
        statusCheckRollup: { state: "SUCCESS" },
        latestReviews: [{ author: { login: "alice" }, state: "APPROVED" }],
        reviewThreads: [{ isResolved: false }, { isResolved: true }],
      })],
    }), true, {
      onOpen: (number, target) => { opened.push({ number, target }) },
    })
    await r.flush()

    const clickLabel = async (label: string, columnOffset = 0) => {
      const lines = r.captureCharFrame().split("\n")
      const y = lines.findIndex((row) => row.includes(label))
      expect(y).toBeGreaterThanOrEqual(0)
      const x = lines[y].indexOf(label) + columnOffset
      await r.mockMouse.click(x, y)
      await r.flush()
    }

    await clickLabel("●", -1)
    expect(opened).toEqual([{ number: 42, target: "checks" }])
    await clickLabel("", -1)
    expect(opened.at(-1)).toEqual({ number: 42, target: "overview" })
    await clickLabel("󰅺1")
    expect(opened.at(-1)).toEqual({ number: 42, target: "files" })
    await clickLabel("1")
    expect(opened.at(-1)).toEqual({ number: 42, target: "files" })
    await clickLabel("+42")
    expect(opened.at(-1)).toEqual({ number: 42, target: "files" })
  })

  test("paginates PRs five at a time and stops at the first and last page", async () => {
    const prs = Array.from({ length: 12 }, (_, i) =>
      makeTUIPR({ number: 10 + i, title: `PR ${10 + i}` }),
    )
    const r = await renderState(okState({ prs }))
    await r.flush()

    const clickArrow = async (pageLabel: string, arrow: string) => {
      const frame = r.captureCharFrame()
      const lines = frame.split("\n")
      const y = lines.findIndex((line) => line.includes(pageLabel))
      expect(y).toBeGreaterThanOrEqual(0)
      const x = lines[y].indexOf(arrow)
      expect(x).toBeGreaterThanOrEqual(0)
      await r.mockMouse.click(x, y)
      await r.flush()
    }

    let frame = r.captureCharFrame()
    expect(frame).toContain("1 of 3")
    expect(frame).toContain(" PR 10")
    expect(frame).toContain(" PR 14")
    expect(frame).not.toContain(" PR 15")

    await clickArrow("1 of 3", "")
    expect(r.captureCharFrame()).toContain("1 of 3")

    await clickArrow("1 of 3", "")
    frame = r.captureCharFrame()
    expect(frame).toContain("2 of 3")
    expect(frame).toContain(" PR 15")
    expect(frame).not.toContain(" PR 14")

    await clickArrow("2 of 3", "")
    expect(r.captureCharFrame()).toContain("3 of 3")
    await clickArrow("3 of 3", "")
    expect(r.captureCharFrame()).toContain("3 of 3")
    await clickArrow("3 of 3", "")
    expect(r.captureCharFrame()).toContain("2 of 3")
  })
})
