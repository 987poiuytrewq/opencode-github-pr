/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { DashboardState, PRScope, PRStatusFilter } from "../../plugins/domain/types"
import { DashboardView } from "../../plugins/app/DashboardView"
import { makeTUIPR } from "../helpers/tui-fixtures"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { loadingState, okState, noRepoState, errorState } from "../helpers/state-fixtures"

async function renderState(state: DashboardState, handlers: Partial<{
  onOpen: (n: number) => void
  onCycleScope: () => void
  onCycleStatus: () => void
  scope: PRScope
  statusFilter: PRStatusFilter
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
        scope={handlers.scope ?? "branch"}
        statusFilter={handlers.statusFilter ?? "open"}
        onCycleScope={handlers.onCycleScope ?? (() => {})}
        onCycleStatus={handlers.onCycleStatus ?? (() => {})}
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
    }), { statusFilter: "closed" })
    await r.flush()
    const frame = captureFrame(r)
    expect(frame).toContain(" Merged feature")
    expect(frame).toContain("#42 +17 -4")
    expect(frame).toContain("●")
    expect(frame).not.toContain("󰅺0")
    expect(frame).not.toContain("0")
  })

  test("hides zero comment counts and only shows non-zero comment statuses", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        reviewThreads: [{ isResolved: false }],
      })],
    }))
    await r.flush()
    const frame = captureFrame(r)
    expect(frame).toContain("󰅺1")
    expect(frame).not.toContain("0")
  })

  test("allows longer titles and truncates at a word boundary", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        title: "This is a very long PR title that should only truncate at a word boundary",
        checkStatuses: ["SUCCESS"],
      })],
    }))
    await r.flush()
    expect(captureFrame(r)).toContain("This is a very long PR title that should only…")
  })

  test("right-aligns status indicators to the edge of the sidebar", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({ checkStatuses: ["SUCCESS"] })],
    }))
    await r.flush()
    const statusLine = r.captureCharFrame().split("\n").find((line) => line.includes("●"))
    expect(statusLine).toBeDefined()
    expect(statusLine?.trimEnd().length).toBe(50)
  })

  test("right-aligns the scope and status filters in the title bar", async () => {
    const r = await renderState(okState())
    await r.flush()
    const heading = r.captureCharFrame().split("\n").find((line) => line.includes("Pull Requests"))
    expect(heading).toContain(" branch   open")
    expect(heading?.trimEnd().length).toBe(50)
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

  test("spaces the heading, PR titles, and status rows as requested", async () => {
    const r = await renderState(okState({
      prs: [
        makeTUIPR({ number: 1, title: "First PR" }),
        makeTUIPR({ number: 2, title: "Second PR" }),
      ],
    }))
    await r.flush()
    const lines = captureFrame(r).split("\n")
    const heading = lines.findIndex((line) => line.includes("Pull Requests"))

    expect(lines[heading + 1]).toBe("")
    expect(lines[heading + 2]).toContain("First PR")
    expect(lines[heading + 3]).toContain("#1")
    expect(lines[heading + 4]).toBe("")
    expect(lines[heading + 5]).toContain("Second PR")
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
    // First PR title is at row 3, after the blank line under the heading.
    await r.mockMouse.click(4, 3)
    await r.flush()
    expect(opened).toEqual([10])
  })

  test("clicking each title-bar filter invokes only its own cycle action", async () => {
    let scopeCycles = 0
    let statusCycles = 0
    const r = await renderState(okState(), {
      onCycleScope: () => { scopeCycles++ },
      onCycleStatus: () => { statusCycles++ },
    })
    await r.flush()
    await r.mockMouse.click(36, 1)
    await r.flush()
    expect(scopeCycles).toBe(1)
    expect(statusCycles).toBe(0)

    await r.mockMouse.click(46, 1)
    await r.flush()
    expect(scopeCycles).toBe(1)
    expect(statusCycles).toBe(1)
  })

  test("each filter turns white only while hovered", async () => {
    const r = await renderState(okState())
    await r.flush()
    const filterSpan = (label: string) =>
      r.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(label))
    const scopeDefault = filterSpan(" branch")
    const statusDefault = filterSpan(" open")
    expect(scopeDefault).toBeDefined()
    expect(statusDefault).toBeDefined()

    await r.mockMouse.moveTo(36, 1)
    await r.flush()
    expect(filterSpan(" branch")?.fg).not.toEqual(scopeDefault?.fg)
    expect(filterSpan(" open")?.fg).toEqual(statusDefault?.fg)

    await r.mockMouse.moveTo(46, 1)
    await r.flush()
    expect(filterSpan(" branch")?.fg).toEqual(scopeDefault?.fg)
    expect(filterSpan(" open")?.fg).not.toEqual(statusDefault?.fg)
  })
})
