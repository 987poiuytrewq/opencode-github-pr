/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { spawn } from "./bun-utils"
import type { TuiPR as PR, Repo, Filter, State, Status } from "./domain/types"
import { BOT_ALIASES, displayLogin, ellipsize } from "./domain/login"
import { SK, skin, toHex, truncateTitle } from "./domain/format"
import {
  classifyCI,
  reviewSummary,
  missingReviewerCount,
  isReadyToMerge,
  fmtAge,
} from "./domain/pr-status"
import { FILTERS } from "./domain/filter"
import { runGh } from "./infra/gh"
import { Header } from "./app/Header"
import { PRRow } from "./app/PRRow"
import { DashboardView } from "./app/DashboardView"
import { useDashboard } from "./app/usePRData"
import {
  currentBranchPR,
  detectRepo,
  fetchBranchRequiredReviews,
  fetchOrgMembers,
  fetchPRs,
  fetchReviewerThreadCounts,
  fetchReviewerThreads,
  JSON_FIELDS,
  REVIEWER_THREADS_QUERY,
  THREAD_COUNT_QUERY,
  type ReviewerThreadCounts,
} from "./infra/loader"

export type { PR, Repo, Filter, State, Status }
export { SK, skin, toHex, truncateTitle }
export {
  classifyCI,
  reviewSummary,
  missingReviewerCount,
  isReadyToMerge,
  fmtAge,
}
export { FILTERS }
export { BOT_ALIASES, displayLogin, ellipsize }
export { runGh } from "./infra/gh"
export {
  currentBranchPR,
  detectRepo,
  fetchBranchRequiredReviews,
  fetchOrgMembers,
  fetchPRs,
  fetchReviewerThreadCounts,
  fetchReviewerThreads,
  JSON_FIELDS,
  REVIEWER_THREADS_QUERY,
  THREAD_COUNT_QUERY,
  type ReviewerThreadCounts,
} from "./infra/loader"
export { Header } from "./app/Header"
export { PRRow } from "./app/PRRow"
export { DashboardView } from "./app/DashboardView"
export { useDashboard } from "./app/usePRData"


const command = {
  refresh: "pr_dashboard.refresh",
  open: "pr_dashboard.open",
  addReviewer: "pr_dashboard.add_reviewer",
  reRequestReview: "pr_dashboard.rerequest_review",
  addCurrentBranch: "pr_dashboard.add_current_branch",
}


const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return
  const ctx = useDashboard(api)

  const openPR = async (n: number) => {
    const pr = ctx.state().prs.find((p) => p.number === n)
    if (!pr) return
    const proc = spawn({ cmd: ["open", pr.url], stdout: "ignore", stderr: "ignore" })
    api.ui.toast({ variant: "info", message: `Opening #${n} in browser…`, duration: 1500 })
    await proc.exited
  }

  const promptReviewer = async (n: number, kind: "add" | "rerequest"): Promise<void> => {
    const label = kind === "add" ? "Add reviewer to" : "Re-request review on"
    const repo = ctx.state().repo
    const members = repo ? await fetchOrgMembers(repo.owner) : []
    const sk = skin(api)
    api.ui.dialog.setSize("large")
    api.ui.dialog.replace(() => {
      const DialogPrompt = api.ui.DialogPrompt
      return (
        <DialogPrompt
          title={`${label} #${n}`}
          placeholder="@username or org/team"
          description={() => (
            <box flexDirection="column">
              <Show when={members.length > 0}>
                <text fg={sk.muted}>Suggested ({members.length} from {repo?.owner}):</text>
                <For each={members.slice(0, 25)}>
                  {(m) => <text fg={sk.text}>  @{m}</text>}
                </For>
                <Show when={members.length > 25}>
                  <text fg={sk.muted}>  … and {members.length - 25} more</text>
                </Show>
              </Show>
              <Show when={members.length === 0}>
                <text fg={sk.muted}>Type any username, team (org/team), or paste a GitHub handle.</text>
              </Show>
            </box>
          )}
          onConfirm={async (value) => {
            const reviewer = value.trim().replace(/^@/, "")
            if (!reviewer) {
              api.ui.dialog.clear()
              return
            }
            const res = await runGh(["gh", "pr", "edit", String(n), "--add-reviewer", reviewer])
            api.ui.dialog.clear()
            if (res.ok) {
              api.ui.toast({ variant: "success", message: `Requested @${reviewer} on #${n}`, duration: 2000 })
              ctx.refreshOne(n)
            } else {
              api.ui.toast({ variant: "error", message: `Failed: ${res.error ?? "unknown"}`, duration: 4000 })
            }
          }}
          onCancel={() => api.ui.dialog.clear()}
        />
      )
    })
  }

  const showReviewerComments = async (n: number, login: string): Promise<void> => {
    const repo = ctx.state().repo
    if (!repo) return
    const sessionID = api.route.current?.name === "session" ? api.route.current?.params?.sessionID : undefined
    if (typeof sessionID !== "string") {
      api.ui.toast({ variant: "error", message: "No active session", duration: 2000 })
      return
    }
    api.ui.toast({ variant: "info", message: `Loading threads from @${login}…`, duration: 1200 })
    const table = await fetchReviewerThreads(repo.owner, repo.repo, n, login)
    try {
      const res = await api.client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: `\n${table}\n`, ignored: true }],
        },
      } as any)
      if ((res as any)?.error) {
        api.ui.toast({ variant: "error", message: `Failed: ${(res as any).error}`, duration: 3000 })
      } else {
        api.ui.toast({ variant: "success", message: `Posted @${login}'s comments to chat`, duration: 1500 })
      }
    } catch (e: any) {
      api.ui.toast({ variant: "error", message: `Failed: ${e?.message ?? "unknown"}`, duration: 3000 })
    }
  }

  const slots: TuiSlotPlugin = {
    order: 250,
    slots: {
      sidebar_content(_ctx, value) {
        return (
          <DashboardView
            api={api}
            state={ctx.state()}
            onRefresh={ctx.refresh}
            selectedIdx={ctx.selectedIdx()}
            setSelectedIdx={ctx.setSelectedIdx}
            onOpen={openPR}
            onAddReviewer={(n) => promptReviewer(n, "add")}
            onReviewerComments={(n, login) => showReviewerComments(n, login)}
            expanded={ctx.expanded()}
            onToggleExpand={ctx.toggleExpanded}
            filter={ctx.state().filter}
            onCycleFilter={ctx.cycleFilter}
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
          ctx.refresh()
          api.ui.toast({ variant: "info", message: "Refreshing PRs…", duration: 1200 })
        },
      },
      {
        name: command.open,
        title: "PRs: Open selected in browser",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-open",
        enabled: () => ctx.state().prs.length > 0,
        run() {
          const pr = ctx.state().prs[ctx.selectedIdx()]
          if (pr) openPR(pr.number)
        },
      },
      {
        name: command.addReviewer,
        title: "PRs: Add reviewer to selected",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-add-reviewer",
        enabled: () => ctx.state().prs.length > 0,
        run() {
          const pr = ctx.state().prs[ctx.selectedIdx()]
          if (pr) promptReviewer(pr.number, "add")
        },
      },
      {
        name: command.reRequestReview,
        title: "PRs: Re-request review on selected",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-rerequest-review",
        enabled: () => ctx.state().prs.length > 0,
        run() {
          const pr = ctx.state().prs[ctx.selectedIdx()]
          if (pr) promptReviewer(pr.number, "rerequest")
        },
      },
      {
        name: command.addCurrentBranch,
        title: "PRs: Add reviewer to current branch PR",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-add-reviewer-current",
        run: async () => {
          const pr = await currentBranchPR()
          if (!pr) {
            api.ui.toast({ variant: "warning", message: "No PR for current branch", duration: 2000 })
            return
          }
          promptReviewer(pr.number, "add")
        },
      },
    ],
    bindings: [],
  })

  api.event.on("session.idle", () => {
    ctx.refresh()
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "pr-dashboard",
  tui,
}

export default plugin
