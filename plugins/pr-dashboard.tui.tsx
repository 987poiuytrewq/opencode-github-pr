/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { DashboardStatus, PRFilter, type DashboardContext, type DashboardState } from "./domain/types"
import { DashboardView } from "./app/DashboardView"
import { useDashboard } from "./app/usePRData"
import { createActions } from "./app/actions"

const command = {
  refresh: "pr_dashboard.refresh",
  open: "pr_dashboard.open",
  addReviewer: "pr_dashboard.add_reviewer",
  reRequestReview: "pr_dashboard.rerequest_review",
  addCurrentBranch: "pr_dashboard.add_current_branch",
}

const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return

  // Reactive signals must live in a .tsx file — Bun's @opentui/solid plugin
  // only rewrites solid-js imports to the reactive build for .tsx/.jsx files.
  // A .ts file importing createSignal gets the SSR (non-reactive) build.
  const [state, setState] = createSignal<DashboardState>({
    status: DashboardStatus.Loading,
    repo: null,
    prs: [],
    fetchedAt: null,
    threadCounts: new Map(),
    branchRules: new Map(),
    filter: PRFilter.Author,
  })
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [expanded, setExpanded] = createSignal(true)
  const toggleExpanded = () => setExpanded((v) => !v)

  const dash = useDashboard(api, state, setState)
  const ctx: DashboardContext = {
    state,
    refresh: dash.refresh,
    refreshOne: dash.refreshOne,
    selectedIdx,
    setSelectedIdx,
    expanded,
    toggleExpanded,
    cycleFilter: dash.cycleFilter,
  }
  const actions = createActions(api, ctx)

  dash.refresh()

  const handle = setInterval(() => {
    if (api.route.current.name === "session") dash.refresh()
  }, 60_000)
  onCleanup(() => clearInterval(handle))

  const slots: TuiSlotPlugin = {
    order: 250,
    slots: {
      sidebar_content() {
        return (
          <DashboardView
            api={api}
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
        )
      },
    },
  }
  api.slots.register(slots)

  api.keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: command.refresh,
        title: "PRs: Refresh dashboard",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-refresh",
        run() {
          dash.refresh()
          api.ui.toast({ variant: "info", message: "Refreshing PRs…", duration: 1200 })
        },
      },
      {
        name: command.open,
        title: "PRs: Open selected in browser",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-open",
        enabled: () => state().prs.length > 0,
        run() {
          const pr = state().prs[selectedIdx()]
          if (pr) actions.openPR(pr.number)
        },
      },
      {
        name: command.addReviewer,
        title: "PRs: Add reviewer to selected",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-add-reviewer",
        enabled: () => state().prs.length > 0,
        run() {
          const pr = state().prs[selectedIdx()]
          if (pr) actions.promptReviewer(pr.number, "add")
        },
      },
      {
        name: command.reRequestReview,
        title: "PRs: Re-request review on selected",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-rerequest-review",
        enabled: () => state().prs.length > 0,
        run() {
          const pr = state().prs[selectedIdx()]
          if (pr) actions.promptReviewer(pr.number, "rerequest")
        },
      },
      {
        name: command.addCurrentBranch,
        title: "PRs: Add reviewer to current branch PR",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-add-reviewer-current",
        run: actions.addReviewerToCurrentBranchPR,
      },
    ],
    bindings: [],
  })

  api.event.on("session.idle", () => {
    dash.refresh()
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "pr-dashboard",
  tui,
}

export default plugin
