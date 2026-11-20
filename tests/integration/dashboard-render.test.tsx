/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
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
  onLoadMore: () => Promise<void>
  scope: PRScope
  statusFilter: PRStatusFilter
  paginationListing: PRStatusFilter
  options: Parameters<typeof dashboardOptions>[0]
}> = {}, width = 50) {
  const { api } = createMockTuiApi()
  const options = dashboardOptions(handlers.options)
  return testRender(
    () => (
      <DashboardView
        theme={api.theme}
        state={{
          ...state,
          pagination: {
            ...state.pagination,
            listing: handlers.paginationListing ?? handlers.statusFilter ?? "open",
            scope: handlers.scope ?? "branch",
            scopeValue: handlers.scope === "branch" || handlers.scope === undefined
              ? state.currentBranch
              : null,
          },
        }}
        setSelectedIdx={() => {}}
        onOpen={handlers.onOpen ?? (() => {})}
        scope={handlers.scope ?? "branch"}
        statusFilter={handlers.statusFilter ?? "open"}
        onCycleScope={handlers.onCycleScope ?? (() => {})}
        onCycleStatus={handlers.onCycleStatus ?? (() => {})}
        onLoadMore={handlers.onLoadMore ?? (async () => {})}
        pageSize={options.pageSize}
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
  test("leaves the dashboard background transparent", async () => {
    const r = await renderState(loadingState())
    await r.flush()
    const heading = r.captureSpans().lines
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes("Pull Requests"))

    expect(heading?.bg?.toInts()[3]).toBe(0)
  })

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

  test("no-repo message uses the same muted styling as other info messages", async () => {
    const r = await renderState(noRepoState())
    await r.flush()
    const spans = r.captureSpans().lines.flatMap((line) => line.spans)
    const title = spans.find((span) => span.text.includes("No GitHub repo"))
    const detail = spans.find((span) => span.text.includes("Add a GitHub remote"))

    expect(title?.fg?.toInts()).toEqual(detail?.fg?.toInts())
    expect(title?.fg?.toInts()).toEqual([136, 136, 136, 255])
  })

  test("error state", async () => {
    const r = await renderState(errorState())
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
  })

  test("authentication help includes the GitHub CLI sign-in command", async () => {
    const r = await renderState(errorState({ errorKind: "authentication" }))
    await r.flush()

    expect(captureFrame(r)).toContain("gh auth login")
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

  test("error description wraps under its text and stays dim", async () => {
    const r = await renderState(errorState({ errorKind: "network" }), {}, 32)
    await r.flush()
    const lines = captureFrame(r).split("\n")
    const descriptionStart = lines.findIndex((line) => line.includes("Check your internet"))
    const descriptionLines = lines.slice(descriptionStart).filter((line) => line.trim().length > 0).slice(0, 2)
    const spans = r.captureSpans().lines.flatMap((line) => line.spans)
    const description = spans.find((span) => span.text.includes("Check your internet"))
    const muted = spans.find((span) => span.text.includes("branch"))

    expect(descriptionStart).toBeGreaterThanOrEqual(0)
    expect(descriptionLines).toHaveLength(2)
    expect(descriptionLines.every((line) => line.startsWith("  "))).toBe(true)
    expect(description?.fg).toEqual(muted?.fg)
  })

  test("no-matching-PR message is muted and single-line", async () => {
    const r = await renderState(okState({ prs: [] }), {}, 32)
    await r.flush()
    const frame = captureFrame(r)
    const titleLines = frame.split("\n").filter((line) => line.includes("No matching PRs"))
    const spans = r.captureSpans().lines.flatMap((line) => line.spans)
    const title = spans.find((span) => span.text.includes("No matching PRs"))

    expect(titleLines).toHaveLength(1)
    expect(frame).not.toContain("Try a different scope or status.")
    expect(title?.fg?.toInts()).toEqual([136, 136, 136, 255])
  })

  test("ok state with empty PRs", async () => {
    const r = await renderState(okState({ prs: [] }))
    await r.flush()
    expect(captureFrame(r)).toMatchSnapshot()
  })

  test("indicates when more server-filtered results are available", async () => {
    const r = await renderState(okState({
      pagination: {
        listing: "open",
        scope: "branch",
        scopeValue: "feature",
        cursor: "cursor-1",
        hasMore: true,
        totalCount: 30,
        pagesLoaded: 4,
        searchResultsFetched: 0,
        supplementalPRCount: 0,
        loading: false,
        limitReached: false,
      },
    }))
    await r.flush()
    expect(captureFrame(r)).toContain("1 of 6")
  })

  test("shows the search-limit notice using the info-panel style", async () => {
    const r = await renderState(okState({
      pagination: {
        listing: "open",
        scope: "branch",
        scopeValue: "feature",
        cursor: null,
        hasMore: false,
        totalCount: 1000,
        pagesLoaded: 4,
        searchResultsFetched: 0,
        supplementalPRCount: 0,
        loading: false,
        limitReached: true,
      },
    }))
    await r.flush()
    const spans = r.captureSpans().lines.flatMap((line) => line.spans)
    const notice = spans.find((span) => span.text.includes("GitHub search is limited"))

    expect(captureFrame(r)).toContain("GitHub search is limited to 1,000 matching PRs")
    expect(notice?.text).toContain(dashboardOptions().icons.info)
    expect(notice?.fg?.toInts()).toEqual([136, 136, 136, 255])
  })

  test("shows a loading line while a server-side status listing is changing", async () => {
    const r = await renderState(loadingState(), {
      scope: "all",
      statusFilter: "closed",
      paginationListing: "open",
    })
    await r.flush()
    const frame = captureFrame(r)
    expect(frame).toContain("Loading PRs")
    expect(frame).not.toContain("Loading closed PRs")
    expect(frame).not.toContain("No matching")
  })

  test("shows the scope being loaded while a scope listing is changing", async () => {
    const { api } = createMockTuiApi()
    const options = dashboardOptions()
    const [scope, setScope] = createSignal<PRScope>("branch")
    const r = await testRender(
      () => (
        <DashboardView
          theme={api.theme}
          state={okState()}
          setSelectedIdx={() => {}}
          onOpen={() => {}}
          scope={scope()}
          statusFilter="open"
          onCycleScope={() => {}}
          onCycleStatus={() => {}}
          onLoadMore={async () => {}}
          pageSize={options.pageSize}
          colors={options.colors}
          icons={options.icons}
        />
      ),
      { width: 50, height: 20 },
    )
    await r.flush()

    setScope("all")
    await r.flush()

    expect(captureFrame(r)).toContain("Loading all PRs")
    expect(captureFrame(r)).not.toContain("Loading open PRs")
    await r.dispose()
  })

  test("resets to the first page when scope changes", async () => {
    const { api } = createMockTuiApi()
    const options = dashboardOptions({ pageSize: 1 })
    const prs = [
      makeTUIPR({ number: 11, title: "First PR" }),
      makeTUIPR({ number: 12, title: "Second PR" }),
      makeTUIPR({ number: 13, title: "Third PR" }),
    ]
    const initialState = okState({ prs })
    initialState.pagination.totalCount = prs.length
    const [scope, setScope] = createSignal<PRScope>("branch")
    const [state, setState] = createSignal(initialState)
    const r = await testRender(
      () => (
        <DashboardView
          theme={api.theme}
          state={state()}
          setSelectedIdx={() => {}}
          onOpen={() => {}}
          scope={scope()}
          statusFilter="open"
          onCycleScope={() => {}}
          onCycleStatus={() => {}}
          onLoadMore={async () => {}}
          pageSize={options.pageSize}
          colors={options.colors}
          icons={options.icons}
        />
      ),
      { width: 50, height: 20 },
    )
    await r.flush()

    let lines = r.captureCharFrame().split("\n")
    let pagerY = lines.findIndex((line) => line.includes("1 of 3"))
    await r.mockMouse.click(lines[pagerY].indexOf(options.icons.nextPage), pagerY)
    await r.flush()
    expect(r.captureCharFrame()).toContain("2 of 3")

    setScope("all")
    await r.flush()
    setState((current) => ({
      ...current,
      pagination: { ...current.pagination, scope: "all", scopeValue: null },
    }))
    await r.flush()

    const frame = r.captureCharFrame()
    lines = frame.split("\n")
    pagerY = lines.findIndex((line) => line.includes("1 of 3"))
    expect(pagerY).toBeGreaterThanOrEqual(0)
    expect(frame).toContain("First PR")
    expect(frame).not.toContain("Second PR")
    await r.dispose()
  })

  test("updates theme-derived colors without recreating the dashboard", async () => {
    const { api } = createMockTuiApi()
    const [theme, setTheme] = createSignal(api.theme)
    const options = dashboardOptions()
    const r = await testRender(
      () => (
        <DashboardView
          theme={theme()}
          state={loadingState()}
          setSelectedIdx={() => {}}
          onOpen={() => {}}
          scope="branch"
          statusFilter="open"
          onCycleScope={() => {}}
          onCycleStatus={() => {}}
          onLoadMore={async () => {}}
          pageSize={options.pageSize}
          colors={options.colors}
          icons={options.icons}
        />
      ),
      { width: 50, height: 20 },
    )
    await r.flush()
    const headingBefore = r.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("Pull Requests"))

    setTheme({
      ...api.theme,
      text: { ...api.theme.text, base: api.theme.text.muted },
    })
    await r.flush()
    const headingAfter = r.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("Pull Requests"))

    expect(headingBefore?.fg?.toInts()).toEqual([229, 229, 229, 255])
    expect(headingAfter?.fg?.toInts()).toEqual([136, 136, 136, 255])
    await r.dispose()
  })

  test("updates PR-row icon colors when the theme changes", async () => {
    const { api } = createMockTuiApi()
    const [theme, setTheme] = createSignal(api.theme)
    const options = dashboardOptions()
    const r = await testRender(
      () => (
        <DashboardView
          theme={theme()}
          state={okState({ prs: [makeTUIPR({ mergeStateStatus: "CLEAN" })] })}
          setSelectedIdx={() => {}}
          onOpen={() => {}}
          scope="branch"
          statusFilter="open"
          onCycleScope={() => {}}
          onCycleStatus={() => {}}
          onLoadMore={async () => {}}
          pageSize={options.pageSize}
          colors={options.colors}
          icons={options.icons}
        />
      ),
      { width: 50, height: 20 },
    )
    await r.flush()
    const iconColor = () =>
      r.captureSpans().lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes(options.icons.openPR))?.fg?.toInts()

    expect(iconColor()).toEqual([95, 191, 95, 255])
    setTheme({
      ...api.theme,
      text: {
        ...api.theme.text,
        feedback: {
          ...api.theme.text.feedback,
          success: api.theme.text.feedback.error,
        },
      },
    })
    await r.flush()

    expect(iconColor()).toEqual([216, 101, 101, 255])
    await r.dispose()
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
    const icons = dashboardOptions().icons
    expect(frame).toContain(`${icons.mergedPR} Merged feature`)
    const mergedIcon = r.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes(icons.mergedPR))
    expect(mergedIcon?.fg?.toInts()).toEqual([86, 182, 194, 255])
    expect(frame).toContain("#42 +17 -4")
    expect(frame).toContain(icons.check)
    expect(frame).not.toContain(`${icons.openComment}0`)
    expect(frame).not.toContain("")
  })

  test("uses configured icons for draft and closed PRs", async () => {
    const r = await renderState(okState({
      prs: [
        makeTUIPR({ number: 1, title: "Draft feature", isDraft: true }),
        makeTUIPR({ number: 2, title: "Closed feature", isClosed: true }),
      ],
    }), {
      statusFilter: "all",
      options: { icons: { draftPR: "D", closedPR: "C" } },
    })
    await r.flush()
    const frame = captureFrame(r)

    expect(frame).toContain("D Draft feature")
    expect(frame).toContain("C Closed feature")
  })

  test("hides zero comment counts and only shows non-zero comment statuses", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        reviewThreads: [{ isResolved: false }],
      })],
    }))
    await r.flush()
    const frame = captureFrame(r)
    const commentIcon = dashboardOptions().icons.openComment
    expect(frame).toContain(`${commentIcon} 1`)
    expect(frame).not.toContain(`${commentIcon}1`)
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
    const titleLine = lines.find((line) => line.includes(`${dashboardOptions().icons.openPR} A`))

    expect(titleLine).toContain("A very long pull…")
    expect(lines.filter((line) => line.includes("request title")).length).toBe(0)
  })

  test("uses the available title width on the first laid-out frame", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        title: "A very long pull request title that must remain on one line",
      })],
    }), {}, 24)
    await r.renderOnce()
    const titleLine = r.captureCharFrame().split("\n")
      .find((line) => line.includes(`${dashboardOptions().icons.openPR} A`))

    expect(titleLine).toContain("A very long pull…")
    expect(titleLine?.length).toBeLessThanOrEqual(24)
    await r.dispose()
  })

  test("updates title width on terminal resize", async () => {
    const title = "A pull request title that fits when wide"
    const r = await renderState(okState({
      prs: [makeTUIPR({ title })],
    }), {}, 24)
    await r.flush()

    expect(captureFrame(r)).toContain("A pull request title…")
    r.resize(60, 20)
    await r.flush()

    expect(captureFrame(r)).toContain(title)
  })

  test("keeps the title ellipsis visible when a configured PR icon is wider than one cell", async () => {
    const r = await renderState(okState({
      prs: [makeTUIPR({
        title: "A very long pull request title that must remain on one line",
      })],
    }), {
      options: { icons: { openPR: "PR" } },
    }, 24)
    await r.flush()
    const titleLine = r.captureCharFrame().split("\n").find((line) => line.includes("PR A"))

    expect(titleLine).toContain("A very long pull…")
    expect(titleLine?.length).toBeLessThanOrEqual(24)
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
    expect(frame).not.toContain("F all")
    expect(frame).toContain("P First")
    expect(frame).toContain("1 of 2")
    expect(frame).not.toContain("P Third")
    const mutedSpan = r.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text === "all")
    expect(mutedSpan?.fg?.toInts()).toEqual([18, 52, 86, 255])
  })

  test("right-aligns the scope and status filters in the title bar", async () => {
    const r = await renderState(okState())
    await r.flush()
    const heading = r.captureCharFrame().split("\n").find((line) => line.includes("Pull Requests"))
    expect(heading).toContain("branch open")
    expect(heading).not.toContain("branch  open")
    expect(heading?.trimEnd().length).toBe(50)
  })

  test("does not leave leading spaces when the scope icon is hidden", async () => {
    const r = await renderState(okState(), { options: { icons: { scope: "" } } })
    await r.flush()
    const heading = r.captureSpans().lines.find((line) => line.spans.some((span) => span.text.includes("Pull Requests")))
    const filterLabels = heading?.spans.map((span) => span.text).filter((text) => text.includes("branch") || text.includes("open"))

    expect(filterLabels).toContain("branch")
    expect(filterLabels).toContain("open")
  })

  test("status groups keep related review and check indicators together", async () => {
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
    const icons = dashboardOptions().icons
    expect(frame).toContain(
      `${icons.openComment} 1 ${icons.review}1${icons.review}1 ${icons.check}3${icons.check}1`,
    )
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
    const icons = dashboardOptions().icons
    expect(frame).toContain(icons.review)
    expect(frame).toContain(`${icons.openComment} 1`)
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
    expect(frame).not.toContain(dashboardOptions().icons.nextPage)
  })

  test("clicking a PR row opens it", async () => {
    const opened: number[] = []
    const r = await renderState(okState(), {
      onOpen: (n) => { opened.push(n) },
    })
    await r.flush()
    const firstPR = r.captureCharFrame().split("\n").findIndex((line) => line.includes("Add login flow"))
    await r.mockMouse.click(4, firstPR)
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
    const header = r.captureCharFrame().split("\n").find((line) => line.includes("Pull Requests")) ?? ""
    await r.mockMouse.click(header.indexOf("branch"), 0)
    await r.flush()
    expect(scopeCycles).toBe(1)
    expect(statusCycles).toBe(0)

    await r.mockMouse.click(header.indexOf("open"), 0)
    await r.flush()
    expect(scopeCycles).toBe(1)
    expect(statusCycles).toBe(1)
  })

  test("each filter turns white only while hovered", async () => {
    const r = await renderState(okState())
    await r.flush()
    const filterSpan = (label: string) =>
      r.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(label))
    const scopeDefault = filterSpan("branch")
    const scopeIconDefault = filterSpan(dashboardOptions().icons.scope)
    const statusDefault = filterSpan("open")
    expect(scopeDefault).toBeDefined()
    expect(scopeIconDefault).toBeDefined()
    expect(statusDefault).toBeDefined()

    const header = r.captureCharFrame().split("\n").find((line) => line.includes("Pull Requests")) ?? ""
    await r.mockMouse.moveTo(header.indexOf("branch"), 0)
    await r.flush()
    expect(filterSpan("branch")?.fg).not.toEqual(scopeDefault?.fg)
    expect(filterSpan(dashboardOptions().icons.scope)?.fg).toEqual(scopeIconDefault?.fg)
    expect(filterSpan("open")?.fg).toEqual(statusDefault?.fg)

    await r.mockMouse.moveTo(header.indexOf("open"), 0)
    await r.flush()
    expect(filterSpan("branch")?.fg).toEqual(scopeDefault?.fg)
    expect(filterSpan("open")?.fg).not.toEqual(statusDefault?.fg)
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
    const firstPR = r.captureCharFrame().split("\n").findIndex((line) => line.includes("Add login flow"))
    await r.mockMouse.click(0, firstPR)
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
    await clickLabel(dashboardOptions().icons.review)
    expect(opened.at(-1)).toEqual({ number: 42, target: "overview" })
    await clickLabel(dashboardOptions().icons.openComment)
    expect(opened.at(-1)).toEqual({ number: 42, target: "files" })
    await clickLabel("+42")
    expect(opened.at(-1)).toEqual({ number: 42, target: "files" })
  })

  test("paginates PRs five at a time and stops at the first and last page", async () => {
    const prs = Array.from({ length: 12 }, (_, i) =>
      makeTUIPR({ number: 10 + i, title: `PR ${10 + i}` }),
    )
    const r = await renderState(okState({
      prs,
      pagination: {
        listing: "all",
        scope: "all",
        scopeValue: null,
        cursor: null,
        hasMore: false,
        totalCount: prs.length,
        pagesLoaded: 1,
        searchResultsFetched: 0,
        supplementalPRCount: 0,
        loading: false,
        limitReached: false,
      },
    }), { scope: "all", statusFilter: "all" })
    await r.flush()

    const clickArrow = async (
      pageLabel: string,
      arrow: string,
      edge?: "before" | "after",
    ) => {
      const frame = r.captureCharFrame()
      const lines = frame.split("\n")
      const y = lines.findIndex((line) => line.includes(pageLabel))
      expect(y).toBeGreaterThanOrEqual(0)
      const arrowX = lines[y].indexOf(arrow)
      expect(arrowX).toBeGreaterThanOrEqual(0)
      const x = edge === "before"
        ? arrowX - 1
        : edge === "after"
          ? arrowX + Bun.stringWidth(arrow)
          : arrowX
      await r.mockMouse.click(x, y)
      await r.flush()
    }

    let frame = r.captureCharFrame()
    const openPRIcon = dashboardOptions().icons.openPR
    expect(frame).toContain("1 of 3")
    expect(frame).toContain(`${openPRIcon} PR 10`)
    expect(frame).toContain(`${openPRIcon} PR 14`)
    expect(frame).not.toContain(`${openPRIcon} PR 15`)

    const pagerLine = frame.split("\n").find((line) => line.includes("1 of 3"))!
    const pageLabelX = pagerLine.indexOf("1 of 3")
    const previousX = pagerLine.indexOf(dashboardOptions().icons.previousPage)
    const nextX = pagerLine.indexOf(dashboardOptions().icons.nextPage)
    expect(pageLabelX - previousX - Bun.stringWidth(dashboardOptions().icons.previousPage)).toBe(1)
    expect(nextX - pageLabelX - Bun.stringWidth("1 of 3")).toBe(1)

    const nextIconColor = () =>
      r.captureSpans().lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes(dashboardOptions().icons.nextPage))?.fg
    const defaultNextIconColor = nextIconColor()
    const pagerY = r.captureCharFrame().split("\n").findIndex((line) => line.includes("1 of 3"))
    await r.mockMouse.moveTo(nextX - 1, pagerY)
    await r.flush()
    expect(nextIconColor()).not.toEqual(defaultNextIconColor)
    await r.mockMouse.moveTo(pageLabelX, pagerY)
    await r.flush()
    expect(nextIconColor()).toEqual(defaultNextIconColor)
    await r.mockMouse.moveTo(nextX + Bun.stringWidth(dashboardOptions().icons.nextPage), pagerY)
    await r.flush()
    expect(nextIconColor()).not.toEqual(defaultNextIconColor)

    await clickArrow("1 of 3", dashboardOptions().icons.previousPage)
    expect(r.captureCharFrame()).toContain("1 of 3")

    await clickArrow("1 of 3", dashboardOptions().icons.nextPage, "before")
    frame = r.captureCharFrame()
    expect(frame).toContain("2 of 3")
    expect(frame).toContain(`${openPRIcon} PR 15`)
    expect(frame).not.toContain(`${openPRIcon} PR 14`)

    await clickArrow("2 of 3", dashboardOptions().icons.nextPage, "after")
    expect(r.captureCharFrame()).toContain("3 of 3")
    await clickArrow("3 of 3", dashboardOptions().icons.nextPage)
    expect(r.captureCharFrame()).toContain("3 of 3")
    await clickArrow("3 of 3", dashboardOptions().icons.previousPage, "before")
    expect(r.captureCharFrame()).toContain("2 of 3")
  })

  test("fetches another GitHub batch when the next page is not loaded yet", async () => {
    let loadRequests = 0
    const r = await renderState(okState({
      prs: [makeTUIPR({ number: 10, title: "Only loaded PR" })],
      pagination: {
        listing: "open",
        scope: "branch",
        scopeValue: "feature",
        cursor: "cursor-4",
        hasMore: true,
        totalCount: 3,
        pagesLoaded: 4,
        searchResultsFetched: 0,
        supplementalPRCount: 0,
        loading: false,
        limitReached: false,
      },
    }), {
      scope: "all",
      options: { pageSize: 1 },
      onLoadMore: async () => { loadRequests++ },
    })
    await r.flush()
    expect(captureFrame(r)).toContain("1 of 3")
    const pagerLine = r.captureCharFrame().split("\n").find((line) => line.includes("1 of 3"))!
    const nextArrow = dashboardOptions().icons.nextPage
    expect(pagerLine.indexOf(nextArrow) + Bun.stringWidth(nextArrow)).toBeLessThanOrEqual(49)

    const lines = r.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes("1 of 3"))
    const x = lines[y].indexOf(dashboardOptions().icons.nextPage)
    await r.mockMouse.click(x, y)
    await r.flush()

    expect(loadRequests).toBe(1)
  })

  test("does not show loading text while pagination is fetching another batch", async () => {
    const r = await renderState(okState({
      pagination: {
        listing: "open",
        scope: "branch",
        scopeValue: "feature",
        cursor: "cursor-4",
        hasMore: true,
        totalCount: 20,
        pagesLoaded: 4,
        searchResultsFetched: 0,
        supplementalPRCount: 0,
        loading: true,
        limitReached: false,
      },
    }))
    await r.flush()

    expect(captureFrame(r)).not.toContain("Loading more PRs")
  })

  test("prefetches another batch on each forward page action", async () => {
    let loadRequests = 0
    const r = await renderState(okState({
      prs: [
        makeTUIPR({ number: 10, title: "First loaded PR" }),
        makeTUIPR({ number: 11, title: "Second loaded PR" }),
      ],
      pagination: {
        listing: "open",
        scope: "branch",
        scopeValue: "feature",
        cursor: "cursor-4",
        hasMore: true,
        totalCount: 5,
        pagesLoaded: 4,
        searchResultsFetched: 0,
        supplementalPRCount: 0,
        loading: false,
        limitReached: false,
      },
    }), {
      scope: "all",
      options: { pageSize: 1 },
      onLoadMore: async () => { loadRequests++ },
    })
    await r.flush()
    expect(captureFrame(r)).toContain("1 of 5")
    const lines = r.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes("1 of 5"))
    const x = lines[y].indexOf(dashboardOptions().icons.nextPage)
    await r.mockMouse.click(x, y)
    await r.flush()
    expect(captureFrame(r)).toContain("2 of 5")
    expect(loadRequests).toBe(1)
  })

  test("does not offer a load-more action when the current scope has no matches", async () => {
    const r = await renderState(okState({
      prs: [],
      pagination: {
        listing: "open",
        scope: "author",
        scopeValue: null,
        cursor: "cursor-4",
        hasMore: true,
        totalCount: 0,
        pagesLoaded: 4,
        searchResultsFetched: 0,
        supplementalPRCount: 0,
        loading: false,
        limitReached: false,
      },
    }), {
      scope: "author",
    })
    await r.flush()
    expect(captureFrame(r)).toContain("No matching")
    expect(captureFrame(r)).not.toContain("Load more results")
  })
})
