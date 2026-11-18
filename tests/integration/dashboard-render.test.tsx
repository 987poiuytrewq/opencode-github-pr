/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { DashboardState, PRScope, PRStatusFilter, PRLinkTarget } from "../../plugins/domain/types"
import { DashboardView } from "../../plugins/app/DashboardView"
import { dashboardOptions } from "../../plugins/app/config"
import { makeTUIPR } from "../helpers/tui-fixtures"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { loadingState, okState, noRepoState, errorState } from "../helpers/state-fixtures"
async function renderState(state: DashboardState, handlers: Partial<{
  onOpen: (n: number, target?: PRLinkTarget) => void
  onCycleScope: () => void
  onCycleStatus: () => void
  scope: PRScope
  statusFilter: PRStatusFilter
  options: Parameters<typeof dashboardOptions>[0]
}> = {}, width = 50) {
  const { api } = createMockTuiApi()
  const options = dashboardOptions(handlers.options)
  return testRender(
    () => (
      <DashboardView
        theme={api.theme}
        state={state}
        setSelectedIdx={() => {}}
        onOpen={handlers.onOpen ?? (() => {})}
        scope={handlers.scope ?? "branch"}
        statusFilter={handlers.statusFilter ?? "open"}
        onCycleScope={handlers.onCycleScope ?? (() => {})}
        onCycleStatus={handlers.onCycleStatus ?? (() => {})}
        pageSize={options.pageSize}
        maxPRPages={options.maxPRPages}
        colors={options.colors}
        icons={options.icons}
      />
    ),
    { width, height: 20 },
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

  test("rate-limit error explains the limit and keeps cached PRs visible", async () => {
    const r = await renderState(errorState({
      errorKind: "rate-limit",
      error: "GitHub API rate limit exceeded — resets at 1:30 PM.",
      prs: [makeTUIPR({ number: 42, title: "Cached PR" })],
    }))
    await r.flush()
    const frame = captureFrame(r)
    const lines = frame.split("\n")
    const heading = lines.findIndex((line) => line.includes("Pull Requests"))
    const statusTitle = lines.findIndex((line) => line.includes("Rate limit exceeded"))

    expect(lines[heading + 1]).toBe("")
    expect(statusTitle).toBe(heading + 2)
    expect(frame).toMatch(/Try again at 1:30\s+PM/)
    expect(frame).toContain("Cached PR")
  })

  test("ok state with empty PRs", async () => {
    const r = await renderState(okState({ prs: [] }))
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
  })

  test("shows when the PR listing was truncated", async () => {
    const r = await renderState(okState({ listingTruncated: true }))
    await r.flush()
    expect(captureFrame(r)).toContain("Showing first 300 PRs; more are available")
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
    expect(frame).not.toContain("")
  })

  test("hides zero comment counts and only shows non-zero comment statuses", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        reviewThreads: [{ isResolved: false }],
      })],
    }))
    await r.flush()
    const frame = captureFrame(r)
    expect(frame).toContain("󰅺 1")
    expect(frame).not.toContain("󰅺1")
    expect(frame).not.toContain("")
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

  test("truncates titles to one line at the available row width", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        title: "A very long pull request title that must remain on one line",
      })],
    }), {}, 24)
    await r.flush()
    const lines = r.captureCharFrame().split("\n")
    const titleLine = lines.find((line) => line.includes(" A"))

    expect(titleLine).toContain("A very long pull…")
    expect(lines.filter((line) => line.includes("request title")).length).toBe(0)
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

  test("applies configured icons, colors, and page size", async () => {
    const r = await renderState(okState({
      prs: [
        makeTUIPR({ number: 1, title: "First" }),
        makeTUIPR({ number: 2, title: "Second" }),
        makeTUIPR({ number: 3, title: "Third" }),
      ],
    }), {
      scope: "all",
      statusFilter: "all",
      options: {
        pageSize: 2,
        colors: { muted: "#123456" },
        icons: { openPR: "P", scope: "S", status: "F", previousPage: "<", nextPage: ">" },
      },
    })
    await r.flush()
    const frame = captureFrame(r)
    expect(frame).toContain("S all")
    expect(frame).toContain("F all")
    expect(frame).toContain("P First")
    expect(frame).toContain("1 of 2")
    expect(frame).not.toContain("P Third")
    const mutedSpan = r.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("S all"))
    expect(mutedSpan?.fg?.toInts()).toEqual([18, 52, 86, 255])
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
    expect(frame).toContain("󰅺 1 1 1 ●3 ●1")
    expect(frame).not.toContain("")
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
    expect(frame).toContain("󰅺 1")
    expect(frame).not.toContain("")
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

  test("clicking the PR number opens the overview without triggering the row click twice", async () => {
    const opened: Array<{ number: number; target?: PRLinkTarget }> = []
    const r = await renderState(okState(), {
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
    const r = await renderState(okState(), {
      onOpen: (number, target) => { opened.push({ number, target }) },
    })
    await r.flush()
    // First PR row starts at y=3; the status icon is its first character.
    await r.mockMouse.click(0, 3)
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
        reviewThreads: [{ isResolved: false }],
      })],
    }), {
      onOpen: (number, target) => { opened.push({ number, target }) },
    })
    await r.flush()

    const clickLabel = async (label: string) => {
      const lines = r.captureCharFrame().split("\n")
      const y = lines.findIndex((row) => row.includes(label))
      expect(y).toBeGreaterThanOrEqual(0)
      const x = Array.from(lines[y].slice(0, lines[y].indexOf(label))).length
      await r.mockMouse.click(x, y)
      await r.flush()
    }

    await clickLabel("●")
    expect(opened).toEqual([{ number: 42, target: "checks" }])
    await clickLabel("")
    expect(opened.at(-1)).toEqual({ number: 42, target: "overview" })
    await clickLabel("󰅺")
    expect(opened.at(-1)).toEqual({ number: 42, target: "files" })
    await clickLabel("+42")
    expect(opened.at(-1)).toEqual({ number: 42, target: "files" })
  })

  test("paginates PRs five at a time and stops at the first and last page", async () => {
    const prs = Array.from({ length: 12 }, (_, i) =>
      makeTUIPR({ number: 10 + i, title: `PR ${10 + i}` }),
    )
    const r = await renderState(okState({ prs }), { scope: "all", statusFilter: "all" })
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
