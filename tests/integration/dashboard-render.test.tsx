/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { DashboardState } from "../../plugins/domain/types"
import { DashboardView } from "../../plugins/app/DashboardView"
import { makeTUIPR } from "../helpers/tui-fixtures"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { loadingState, okState, noRepoState, errorState } from "../helpers/state-fixtures"

async function renderState(state: DashboardState, handlers: Partial<{
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
      />
    ),
    { width: 50, height: 20 },
  )
}

function captureFrame(r: Awaited<ReturnType<typeof renderState>>): string {
  return r.captureCharFrame().split("\n").map((line) => line.trimEnd()).join("\n")
}

describe("DashboardView render", () => {
  test("loading state", async () => {
    const r = await renderState(loadingState())
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
  })

  test("ok state with PRs", async () => {
    const r = await renderState(okState())
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
  })

  test("no-repo state", async () => {
    const r = await renderState(noRepoState())
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
  })

  test("error state", async () => {
    const r = await renderState(errorState())
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
  })

  test("ok state with empty PRs", async () => {
    const r = await renderState(okState({ prs: [] }))
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
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
    const frame = captureFrame(r)
    expect(frame).toContain(" Merged feature")
    expect(frame).toContain("#42 +17 -4")
    expect(frame).toContain("●")
    expect(frame).toContain("󰅺0")
    expect(frame).toContain("0")
  })

  test("status groups render comments, reviews, then mixed checks with single spaces", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        number: 42,
        title: "Mixed status PR",
        checkStatuses: ["SUCCESS", "SUCCESS", "SUCCESS", "FAILURE"],
        reviewThreads: [{ isResolved: false }, { isResolved: true }],
        latestReviews: [
          { author: { login: "alice" }, state: "APPROVED" },
          { author: { login: "bob" }, state: "CHANGES_REQUESTED" },
        ],
      })],
    }))
    await r.flush()
    const frame = captureFrame(r)
    expect(frame).toContain("󰅺1 1 1 1 ●3 ●1")
  })
})

describe("DashboardView mouse interaction", () => {
  test("the PR list is visible without a collapse control", async () => {
    const r = await renderState(okState())
    await r.flush()
    const frame = captureFrame(r)
    expect(frame).toContain("Pull Requests")
    expect(frame).toContain("Add login flow")
    expect(frame).not.toContain("▼")
    expect(frame).not.toContain("▶")
  })

  test("clicking a PR row opens it", async () => {
    const opened: number[] = []
    const r = await renderState(okState(), {
      onOpen: (n) => { opened.push(n) },
    })
    await r.flush()
    // First PR row "#10 Add login flow" is at row 2.
    await r.mockMouse.click(4, 2)
    await r.flush()
    expect(opened).toEqual([10])
  })
})
