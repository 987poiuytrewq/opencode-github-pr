/** @jsxImportSource @opentui/solid */
import open from "open"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import { prTargetUrl } from "../domain/pr-links"
import { parseReviewerInput } from "../domain/reviewer"
import type { DashboardContext, PRLinkTarget } from "../domain/types"
import { getOctokit } from "../infra/octokit"

export interface PrActions {
  openPR: (n: number, target?: PRLinkTarget) => Promise<void>
  requestReviewer: (n: number, input?: string) => Promise<void>
}

// Build callbacks used by the sidebar and keymap using the V2 local TUI API.
export function createActions(api: TuiPluginContext, ctx: DashboardContext): PrActions {
  const openPR = async (n: number, target: PRLinkTarget = "overview") => {
    const pr = ctx.state().prs.find((p) => p.number === n)
    if (!pr) return
    try {
      await open(prTargetUrl(pr.url, target))
      api.ui.toast.show({ variant: "info", message: `Opening #${n} in browser…`, duration: 1500 })
    } catch {
      api.ui.toast.show({ variant: "error", message: `Couldn't open #${n} in browser`, duration: 2500 })
    }
  }

  const requestReviewer = async (n: number, input?: string) => {
    const pr = ctx.state().prs.find((p) => p.number === n)
    const repo = ctx.state().repo
    if (!pr || !repo) return

    try {
      const reviewerInput =
        input?.trim() ||
        (await api.ui.dialog.prompt({
          title: `Request review on #${n}`,
          description:
            "Enter a GitHub username or org/team-slug (for example: octocat or acme/design).",
          placeholder: "username or org/team-slug",
        }))
      if (!reviewerInput?.trim()) return

      const reviewer = parseReviewerInput(reviewerInput, repo.owner)
      const params = {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: n,
        ...(reviewer.kind === "user"
          ? { reviewers: [reviewer.login] }
          : { team_reviewers: [reviewer.slug] }),
      }
      await getOctokit().pulls.requestReviewers(params)
      const label =
        reviewer.kind === "user"
          ? `@${reviewer.login}`
          : `${repo.owner}/${reviewer.slug}`
      api.ui.toast.show({
        variant: "info",
        message: `Review requested from ${label} on #${n}.`,
        duration: 2500,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? ` (HTTP ${String(error.status)})`
          : ""
      api.ui.toast.show({
        variant: "error",
        message: `Couldn't request reviewer${status}: ${message}`,
        duration: 4000,
      })
    }
  }

  return { openPR, requestReviewer }
}
