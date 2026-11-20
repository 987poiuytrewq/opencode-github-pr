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
import { filterPRs, nextPRScope, nextPRStatusFilter } from "./domain/pr-filters"
import { DashboardView } from "./app/DashboardView"
import { useDashboard } from "./app/usePRData"
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
    pagination: {
      listing: "open",
      scope: "all",
      scopeValue: null,
      cursor: null,
      hasMore: false,
      totalCount: null,
      pagesLoaded: 0,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      loading: false,
      limitReached: false,
    },
  })
  const demoMode = process.env.OPENCODE_GITHUB_PR_DEMO === "1"
  if (demoMode) {
    const { demoDashboardState } = await import("../demo/fixtures")
    setState(demoDashboardState())
  }
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [scope, setScope] = createSignal<PRScope>(options.defaultScope)
  const [statusFilter, setStatusFilter] = createSignal<PRStatusFilter>(options.defaultStatusFilter)
  const visiblePRs = () =>
    filterPRs(state().prs, scope(), statusFilter(), state().currentBranch, state().viewerLogin)
  const cycleScope = () => {
    const nextScope = nextPRScope(scope())
    setScope(nextScope)
    setSelectedIdx(0)
    if (demoMode) {
      const currentState = state()
      setState((s) => ({
        ...s,
        pagination: {
          ...s.pagination,
          scope: nextScope,
          scopeValue: nextScope === "branch" ? s.currentBranch : null,
          totalCount: filterPRs(
            currentState.prs,
            nextScope,
            statusFilter(),
            currentState.currentBranch,
            currentState.viewerLogin,
          ).length,
        },
      }))
    } else {
      void dash.refresh()
    }
  }
  const cycleStatus = () => {
    const nextStatus = nextPRStatusFilter(statusFilter())
    setStatusFilter(nextStatus)
    setSelectedIdx(0)
    // Each status is queried separately so GitHub applies the status filter.
    if (demoMode) {
      const currentState = state()
      setState((s) => ({
        ...s,
        pagination: {
          ...s.pagination,
          listing: nextStatus,
          totalCount: filterPRs(
            currentState.prs,
            scope(),
            nextStatus,
            currentState.currentBranch,
            currentState.viewerLogin,
          ).length,
        },
      }))
    } else {
      void dash.refresh()
    }
  }

  const dash = demoMode
    ? { refresh: async () => {}, loadMore: async () => {} }
    : useDashboard(
        api,
        state,
        setState,
        options.requestTimeoutMs,
        options.pagesPerBatch,
        statusFilter,
        scope,
        options.pageSize,
        options.recentPRsLimit,
      )
  const dashboard: DashboardContext = {
    state,
    refresh: dash.refresh,
    loadMore: dash.loadMore,
    selectedIdx,
    setSelectedIdx,
  }
  const actions = createActions(api, dashboard)

  if (!demoMode) void dash.refresh()

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
        onLoadMore={dash.loadMore}
        pageSize={options.pageSize}
        colors={options.colors}
        icons={options.icons}
        spacing={options.spacing}
        showSingleStatusCount={options.showSingleStatusCount}
      />
    ),
  })
  // OpenCode 2.0 provides Keymap.Provider through the TUI's Solid render
  // context. Register this from a slot render rather than setup so the
  // provider is present on early V2 host releases as well.
  let unregisterKeymap: (() => void) | undefined
  const unregisterKeymapSlot = api.ui.slot({
    append: "app",
    render: () => {
      if (!unregisterKeymap) {
        const keymapLayer = api.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: command.refresh,
              title: "PRs: Refresh dashboard",
              group: "PR Dashboard",
              palette: true,
              slash: { name: "pr-refresh" },
              run() {
                void dash.refresh().then(() => {
                  const current = state()
                  if (current.errorKind === "rate-limit") {
                    api.ui.toast.show({
                      variant: "info",
                      message: `PR refresh paused: ${current.error ?? "rate limit active"}`,
                      duration: 5000,
                    })
                    return
                  }
                  api.ui.toast.show({ variant: "info", message: "Refreshing PRs…", duration: 1200 })
                })
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
                const pr = visiblePRs()[selectedIdx()]
                if (pr) void actions.openPR(pr.number)
              },
            },
          ],
        }))
        if (typeof keymapLayer === "function") unregisterKeymap = keymapLayer
      }
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
    unregisterKeymap?.()
  }
}

export default Plugin.define({
  id: "opencode-github-pr.tui",
  setup,
})
