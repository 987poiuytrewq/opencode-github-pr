/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import {
  DashboardStatus,
  type DashboardContext,
  type DashboardState,
  type PRScope,
  type PRStatusFilter,
} from "./domain/types"
import { nextPRScope, nextPRStatusFilter } from "./domain/pr-filters"
import { DashboardView } from "./app/DashboardView"
import { useDashboard, type PRPageLoader } from "./app/usePRData"
import { createActions } from "./app/actions"
import { dashboardOptions } from "./app/config"

const command = {
  refresh: "opencode-github-pr.refresh",
  open: "opencode-github-pr.open",
}

async function setup(api: TuiPluginContext) {
  const options = dashboardOptions(api.options)
  if (!options.enabled) return

  const [state, setState] = createSignal<DashboardState>({
    status: DashboardStatus.Loading,
    repo: null,
    prs: [],
    currentBranch: null,
    viewerLogin: null,
    fetchedAt: null,
    page: 0,
    totalCount: 0,
    hasNextPage: false,
  })
  // Demo mode serves fictional PRs from local fixtures instead of GitHub.
  let loadPage: PRPageLoader | undefined
  if (process.env.OPENCODE_GITHUB_PR_DEMO === "1") {
    loadPage = (await import("../demo/fixtures")).demoPageLoader
  }
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [scope, setScope] = createSignal<PRScope>(options.defaultScope)
  const [statusFilter, setStatusFilter] = createSignal<PRStatusFilter>(options.defaultStatusFilter)
  const visiblePRs = () => state().prs
  const dash = useDashboard(api, state, setState, {
    filters: () => ({ scope: scope(), statusFilter: statusFilter() }),
    pageSize: options.pageSize,
    requestTimeoutMs: options.requestTimeoutMs,
    loadPage,
  })
  // Filters run on GitHub, so changing one loads its first page.
  const cycleScope = () => {
    setScope(nextPRScope(scope()))
    setSelectedIdx(0)
    void dash.refresh(0)
  }
  const cycleStatus = () => {
    setStatusFilter(nextPRStatusFilter(statusFilter()))
    setSelectedIdx(0)
    void dash.refresh(0)
  }
  const goToPage = (page: number) => {
    setSelectedIdx(0)
    void dash.refresh(page)
  }
  const dashboard: DashboardContext = {
    state,
    refresh: dash.refresh,
    refreshOne: dash.refreshOne,
    selectedIdx,
    setSelectedIdx,
  }
  const actions = createActions(api, dashboard)

  void dash.refresh()

  const unregisterSlot = api.ui.slot({
    append: "sidebar.content",
    render: () => (
      <DashboardView
        theme={api.theme}
        state={state()}
        setSelectedIdx={setSelectedIdx}
        onOpen={actions.openPR}
        scope={scope()}
        statusFilter={statusFilter()}
        onCycleScope={cycleScope}
        onCycleStatus={cycleStatus}
        onPageChange={goToPage}
        pageSize={options.pageSize}
        colors={options.colors}
        icons={options.icons}
      />
    ),
  })
  // OpenCode 2.0 provides Keymap.Provider through the TUI's Solid render
  // context. Register this from a slot render rather than setup so the
  // provider is present on early V2 host releases as well.
  const unregisterKeymapSlot = api.ui.slot({
    append: "app",
    render: () => {
      api.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: command.refresh,
            title: "PRs: Refresh dashboard",
            group: "PR Dashboard",
            palette: true,
            slash: { name: "pr-refresh" },
            run() {
              void dash.refresh()
              api.ui.toast.show({ variant: "info", message: "Refreshing PRs…", duration: 1200 })
            },
          },
          {
            id: command.open,
            title: "PRs: Open selected in browser",
            group: "PR Dashboard",
            palette: true,
            slash: { name: "pr-open" },
            enabled: () => visiblePRs().length > 0,
            run() {
              const pr = visiblePRs()[selectedIdx()] ?? visiblePRs()[0]
              if (pr) void actions.openPR(pr.number)
            },
          },
        ],
      }))
      return null
    },
  })

  const stopOnIdle = api.data.on("session.idle", () => {
    void dash.refresh()
  })
  const interval = setInterval(() => {
    if (api.ui.router.current().type === "session") void dash.refresh()
  }, options.refreshIntervalMs)

  return () => {
    clearInterval(interval)
    stopOnIdle()
    unregisterSlot()
    unregisterKeymapSlot()
  }
}

export default Plugin.define({
  id: "opencode-github-pr.tui",
  setup,
})
