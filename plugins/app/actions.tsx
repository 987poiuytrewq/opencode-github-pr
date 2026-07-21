/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import { spawn } from "bun"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { skin } from "./theme"
import { errorMessages } from "../domain/messages"
import {
  addPullRequestReviewer,
  currentBranchPR,
  fetchOrgMembers,
  fetchReviewerThreads,
  fetchOnePR,
} from "../infra/loader"
import { formatReviewerThreads } from "../domain/reviewers"
import type { DashboardContext } from "../domain/types"

export interface PrActions {
  openPR: (n: number) => Promise<void>
  promptReviewer: (n: number, kind: "add" | "rerequest") => Promise<void>
  showReviewerComments: (n: number, login: string) => Promise<void>
  addReviewerToCurrentBranchPR: () => Promise<void>
}

// Build the action callbacks used by the sidebar slot and keymap. Each
// action takes the api + dashboard context so it can read state, toast,
// open dialogs, and post to chat without the TUI entry point owning that
// logic.
export function createActions(api: TuiPluginApi, ctx: DashboardContext): PrActions {
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
            const cur = ctx.state().repo
            if (!cur) {
              api.ui.dialog.clear()
              api.ui.toast({ variant: "error", message: errorMessages.noRepo, duration: 2000 })
              return
            }
            api.ui.dialog.clear()
            try {
              await addPullRequestReviewer(cur, n, reviewer)
              api.ui.toast({
                variant: "success",
                message: `Requested @${reviewer} on #${n}`,
                duration: 2000,
              })
              await ctx.refreshOne(n)
            } catch (e: any) {
              api.ui.toast({
                variant: "error",
                message: errorMessages.failed(e?.message ?? errorMessages.unknown),
                duration: 4000,
              })
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
    const sessionID =
      api.route.current?.name === "session" ? api.route.current?.params?.sessionID : undefined
    if (typeof sessionID !== "string") {
      api.ui.toast({ variant: "error", message: errorMessages.noActiveSession, duration: 2000 })
      return
    }
    api.ui.toast({ variant: "info", message: `Loading threads from @${login}…`, duration: 1200 })
    let body: string
    try {
      const threads = await fetchReviewerThreads(repo.owner, repo.repo, n, login)
      body = formatReviewerThreads(threads, login, n)
    } catch (e: any) {
      body = `_${e?.message ?? "Failed to fetch threads"}_`
    }
    try {
      const res = await api.client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: `\n${body}\n`, ignored: true }],
        },
      } as any)
      if ((res as any)?.error) {
        api.ui.toast({
          variant: "error",
          message: errorMessages.failed(String((res as any).error)),
          duration: 3000,
        })
      } else {
        api.ui.toast({
          variant: "success",
          message: `Posted @${login}'s comments to chat`,
          duration: 1500,
        })
      }
    } catch (e: any) {
      api.ui.toast({
        variant: "error",
        message: errorMessages.failed(e?.message ?? errorMessages.unknown),
        duration: 3000,
      })
    }
  }

  const addReviewerToCurrentBranchPR = async () => {
    const repo = ctx.state().repo
    if (!repo) {
      api.ui.toast({ variant: "warning", message: errorMessages.noRepo, duration: 2000 })
      return
    }
    const pr = await currentBranchPR(repo)
    if (!pr) {
      api.ui.toast({ variant: "warning", message: "No PR for current branch", duration: 2000 })
      return
    }
    await promptReviewer(pr.number, "add")
  }

  return { openPR, promptReviewer, showReviewerComments, addReviewerToCurrentBranchPR }
}

// Keep fetchOnePR re-exported so tests can stub it via setOctokit without
// reaching into infra/loader directly.
export { fetchOnePR }
