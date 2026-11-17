/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import { DashboardStatus, PRFilter, type DashboardContext, type DashboardState } from "./domain/types"
import { DashboardView } from "./app/DashboardView"
import { useDashboard } from "./app/usePRData"
import { createActions } from "./app/actions"

const command = {
  refresh: "opencode-github-pr.refresh",
  open: "opencode-github-pr.open",
  addReviewer: "opencode-github-pr.add-reviewer",
  reRequestReview: "opencode-github-pr.rerequest-review",
  addCurrentBranch: "opencode-github-pr.add-current-branch-reviewer",
}

function setup(api: TuiPluginContext) {
  if (api.options.enabled === false) return

  const [state, setState] = createSignal<DashboardState>({
    status: DashboardStatus.Loading,
    repo: null,
    prs: [],
    fetchedAt: null,
    filter: PRFilter.Author,
  })
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [expanded, setExpanded] = createSignal(true)
  const toggleExpanded = () => setExpanded((value) => !value)

  const dash = useDashboard(api, state, setState)
  const dashboard: DashboardContext = {
    state,
    refresh: dash.refresh,
    refreshOne: dash.refreshOne,
    selectedIdx,
    setSelectedIdx,
    expanded,
    toggleExpanded,
    cycleFilter: dash.cycleFilter,
  }
  const actions = createActions(api, dashboard)

  void dash.refresh()

  const unregisterSlot = api.ui.slot({
    append: "sidebar.content",
    render: () => (
      <DashboardView
        theme={api.theme}
        state={state()}
        onRefresh={dash.refresh}
        selectedIdx={selectedIdx()}
        setSelectedIdx={setSelectedIdx}
        onOpen={actions.openPR}
        onAddReviewer={(n) => actions.promptReviewer(n, "add")}
        onReviewerComments={(n, login) => actions.showReviewerComments(n, login)}
        expanded={expanded()}
        onToggleExpand={toggleExpanded}
        filter={state().filter}
        onCycleFilter={dash.cycleFilter}
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
            enabled: () => state().prs.length > 0,
            run() {
              const pr = state().prs[selectedIdx()]
              if (pr) void actions.openPR(pr.number)
            },
          },
          {
            id: command.addReviewer,
            title: "PRs: Add reviewer to selected",
            group: "PR Dashboard",
            palette: true,
            slash: { name: "pr-add-reviewer" },
            enabled: () => state().prs.length > 0,
            run() {
              const pr = state().prs[selectedIdx()]
              if (pr) void actions.promptReviewer(pr.number, "add")
            },
          },
          {
            id: command.reRequestReview,
            title: "PRs: Re-request review on selected",
            group: "PR Dashboard",
            palette: true,
            slash: { name: "pr-rerequest-review" },
            enabled: () => state().prs.length > 0,
            run() {
              const pr = state().prs[selectedIdx()]
              if (pr) void actions.promptReviewer(pr.number, "rerequest")
            },
          },
          {
            id: command.addCurrentBranch,
            title: "PRs: Add reviewer to current branch PR",
            group: "PR Dashboard",
            palette: true,
            slash: { name: "pr-add-reviewer-current" },
            run: () => actions.addReviewerToCurrentBranchPR(),
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
