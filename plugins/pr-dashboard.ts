import { tool, type Plugin } from "@opencode-ai/plugin"
import { detectRepo, listOpenPRs } from "./pr-dashboard/infra/server-gh"
import {
  formatDashboard,
  noRepoError,
  ghListError,
} from "./pr-dashboard/application/format-dashboard"

const PrDashboardPlugin: Plugin = async ({ $, directory }) => {
  const prEditReviewer = async (cwd: string, pr: number, reviewer: string) => {
    try {
      const out =
        await $`gh pr edit ${pr} --add-reviewer ${reviewer}`.cwd(cwd).text()
      return `Requested review from @${reviewer} on PR #${pr}.${out ? "\n" + out : ""}`
    } catch (e) {
      return `Error: failed to add reviewer: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const prRerequestReview = async (cwd: string, pr: number, reviewer: string) => {
    try {
      const out =
        await $`gh pr edit ${pr} --add-reviewer ${reviewer}`.cwd(cwd).text()
      return `Re-requested review from @${reviewer} on PR #${pr}.${out ? "\n" + out : ""}`
    } catch (e) {
      return `Error: failed to re-request review: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  return {
    tool: {
      pr_dashboard: tool({
        description:
          "List open GitHub pull requests for the current repository with CI status, review status (approvals, change requests, comments, pending reviewer count and logins), and mergeable state. Run this when the user asks about open PRs, what needs review, what's blocked on CI, or wants a status overview. Returns a compact human-readable summary plus a structured JSON array for programmatic use.",
        args: {
          author: tool.schema
            .enum(["me", "any"])
            .optional()
            .describe(
              "Filter PRs: 'me' for PRs I authored, 'any' (default) for all open PRs",
            ),
        },
        async execute(args, context) {
          const cwd = context.directory ?? directory
          const repo = await detectRepo($, cwd)
          if (!repo) return noRepoError(cwd)
          const author = args.author ?? "any"
          let prs
          try {
            prs = await listOpenPRs($, author)
          } catch (e) {
            return ghListError(e)
          }
          return formatDashboard(repo, prs, author).text
        },
      }),

      pr_add_reviewer: tool({
        description:
          "Add a reviewer (or team) to a GitHub pull request. Use when the user wants to request a review from someone. Use gh CLI; the user is the authenticated actor.",
        args: {
          pr: tool.schema.number().describe("Pull request number"),
          reviewer: tool.schema
            .string()
            .describe(
              "GitHub username (e.g. 'octocat') or team slug (e.g. 'org/team-name')",
            ),
        },
        async execute(args, context) {
          return prEditReviewer(context.directory ?? directory, args.pr, args.reviewer)
        },
      }),

      pr_rerequest_review: tool({
        description:
          "Re-request a review from a user (or team) on a GitHub pull request. Use when a reviewer has already reviewed and the author wants a fresh look, or when a previous review request was dismissed. Uses `gh pr edit --add-reviewer` which on GitHub re-sends the review request when the user is already a reviewer.",
        args: {
          pr: tool.schema.number().describe("Pull request number"),
          reviewer: tool.schema
            .string()
            .describe(
              "GitHub username (e.g. 'octocat') or team slug (e.g. 'org/team-name')",
            ),
        },
        async execute(args, context) {
          return prRerequestReview(
            context.directory ?? directory,
            args.pr,
            args.reviewer,
          )
        },
      }),
    },
  }
}

export default PrDashboardPlugin
