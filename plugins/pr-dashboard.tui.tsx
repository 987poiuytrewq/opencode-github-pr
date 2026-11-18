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

const command = {
  refresh: "opencode-github-pr.refresh",
  open: "opencode-github-pr.open",
}

async function setup(api: TuiPluginContext) {
  if (api.options.enabled === false) return

  const [state, setState] = createSignal<DashboardState>({
    status: DashboardStatus.Loading,
    repo: null,
    prs: [],
    currentBranch: null,
    viewerLogin: null,
    fetchedAt: null,
    listingTruncated: false,
  })
  const demoMode = process.env.OPENCODE_GITHUB_PR_DEMO === "1"
  if (demoMode) {
    const { demoDashboardState } = await import("../demo/fixtures")
    setState(demoDashboardState())
  }
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [scope, setScope] = createSignal<PRScope>("author")
  const [statusFilter, setStatusFilter] = createSignal<PRStatusFilter>("open")
  const visiblePRs = () =>
    filterPRs(state().prs, scope(), statusFilter(), state().currentBranch, state().viewerLogin)
  const cycleScope = () => {
    setScope(nextPRScope(scope()))
    setSelectedIdx(0)
  }
  const cycleStatus = () => {
    setStatusFilter(nextPRStatusFilter(statusFilter()))
    setSelectedIdx(0)
  }

  const dash = demoMode
    ? { refresh: async () => {}, refreshOne: async () => {} }
    : useDashboard(api, state, setState)
  const dashboard: DashboardContext = {
    state,
    refresh: dash.refresh,
    refreshOne: dash.refreshOne,
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
              const pr = visiblePRs()[selectedIdx()]
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
  }, 60_000)

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
