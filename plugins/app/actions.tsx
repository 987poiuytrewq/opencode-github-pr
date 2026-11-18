/** @jsxImportSource @opentui/solid */
import { spawn } from "bun"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import { errorMessages } from "../domain/messages"
import {
  addPullRequestReviewer,
  currentBranchPR,
  fetchOrgMembers,
} from "../infra/loader"
import { prTargetUrl } from "../domain/pr-links"
import type { DashboardContext, PRLinkTarget } from "../domain/types"

export interface PrActions {
  openPR: (n: number, target?: PRLinkTarget) => Promise<void>
  promptReviewer: (n: number, kind: "add" | "rerequest") => Promise<void>
  addReviewerToCurrentBranchPR: () => Promise<void>
}

function currentDirectory(api: TuiPluginContext): string {
  const route = api.ui.router.current()
  if (route.type === "session") {
    const directory = api.data.session.get(route.sessionID)?.location.directory
    if (directory) return directory
  }
  return api.location?.directory ?? api.data.location.default().directory ?? process.cwd()
}

// Build callbacks used by the sidebar and keymap using the V2 local TUI API.
export function createActions(api: TuiPluginContext, ctx: DashboardContext): PrActions {
  const openPR = async (n: number, target: PRLinkTarget = "overview") => {
    const pr = ctx.state().prs.find((p) => p.number === n)
    if (!pr) return
    const proc = spawn({ cmd: ["open", prTargetUrl(pr.url, target)], stdout: "ignore", stderr: "ignore" })
    api.ui.toast.show({ variant: "info", message: `Opening #${n} in browser…`, duration: 1500 })
    await proc.exited
  }

  const promptReviewer = async (n: number, kind: "add" | "rerequest"): Promise<void> => {
    const label = kind === "add" ? "Add reviewer to" : "Re-request review on"
    const repo = ctx.state().repo
    const members = repo ? await fetchOrgMembers(repo.owner) : []
    api.ui.dialog.set({ size: "large" })
    const value = await api.ui.dialog.prompt({
      title: `${label} #${n}`,
      placeholder: "@username or org/team",
      description: members.length
        ? `Suggested from ${repo?.owner}: ${members.slice(0, 25).map((member) => `@${member}`).join(" ")}${members.length > 25 ? ` … and ${members.length - 25} more` : ""}`
        : "Type any username, team (org/team), or paste a GitHub handle.",
    })
    const rawReviewer = value?.trim()
    const reviewer = rawReviewer?.includes("/") ? rawReviewer : rawReviewer?.replace(/^@/, "")
    if (!reviewer) return

    const cur = ctx.state().repo
    if (!cur) {
      api.ui.toast.show({ variant: "error", message: errorMessages.noRepo, duration: 2000 })
      return
    }
    try {
      await addPullRequestReviewer(cur, n, reviewer)
      api.ui.toast.show({
        variant: "success",
        message: `${kind === "add" ? "Requested" : "Re-requested"} review from @${reviewer} on #${n}`,
        duration: 2000,
      })
      await ctx.refreshOne(n)
    } catch (e: unknown) {
      api.ui.toast.show({
        variant: "error",
        message: errorMessages.failed(e instanceof Error ? e.message : errorMessages.unknown),
        duration: 4000,
      })
    }
  }

  const addReviewerToCurrentBranchPR = async () => {
    const repo = ctx.state().repo
    if (!repo) {
      api.ui.toast.show({ variant: "warning", message: errorMessages.noRepo, duration: 2000 })
      return
    }
    const pr = await currentBranchPR(repo, currentDirectory(api))
    if (!pr) {
      api.ui.toast.show({ variant: "warning", message: "No PR for current branch", duration: 2000 })
      return
    }
    await promptReviewer(pr.number, "add")
  }

  return { openPR, promptReviewer, addReviewerToCurrentBranchPR }
}
