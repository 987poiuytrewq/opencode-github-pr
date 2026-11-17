/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { DashboardState } from "../../plugins/domain/types"
import { DashboardView } from "../../plugins/app/DashboardView"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { loadingState, okState, noRepoState, errorState } from "../helpers/state-fixtures"

async function renderState(state: DashboardState, expanded = true, handlers: Partial<{
  onCycleFilter: () => void
  onToggleExpand: () => void
  onOpen: (n: number) => void
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
        onAddReviewer={() => {}}
        onReviewerComments={() => {}}
        filter={state.filter}
        onCycleFilter={handlers.onCycleFilter ?? (() => {})}
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
})

describe("DashboardView mouse interaction", () => {
  test("clicking the filter cycles the filter", async () => {
    let cycleCalls = 0
    let toggleCalls = 0
    const r = await renderState(okState(), true, {
      onCycleFilter: () => { cycleCalls++ },
      onToggleExpand: () => { toggleCalls++ },
    })
    await r.flush()
    const frame = r.captureCharFrame()
    // Find where "author:@me" appears in the frame (should be on the right)
    const lines = frame.split("\n")
    const headerLine = lines[1]
    const filterIdx = headerLine.indexOf("author:@me")
    expect(filterIdx).toBeGreaterThan(20) // confirm it's on the right side
    const clickCol = filterIdx + 3 // click in the middle of "author:@me"
    await r.mockMouse.click(clickCol, 1)
    await r.flush()
    expect(cycleCalls).toBe(1)
    expect(toggleCalls).toBe(0)
  })

  test("clicking the header toggles expand", async () => {
    let toggles = 0
    const r = await renderState(okState(), true, {
      onToggleExpand: () => { toggles++ },
    })
    await r.flush()
    // "▼ PRs" is at the left of row 1. Click on "PRs".
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
})
