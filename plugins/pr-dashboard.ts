import { tool, type Plugin } from "@opencode-ai/plugin"
import { errorMessages } from "./domain/messages"
import { addPullRequestReviewer } from "./infra/loader"
import { detectRepo } from "./infra/git"
import type { Repo } from "./domain/types"

export function noRepoError(cwd: string): string {
  return `${errorMessages.noRepo} (${cwd})`
}

// Shared implementation for pr_add_reviewer and pr_rerequest_review.
// Both tools call the same GitHub endpoint (requestReviewers is
// idempotent); only the user-facing verb in the success message differs.
async function requestReview(
  cwd: string,
  pr: number,
  reviewer: string,
  verb: "Requested" | "Re-requested",
): Promise<string> {
  const repo: Repo = detectRepo(cwd)
  if (!repo) return noRepoError(cwd)
  try {
    await addPullRequestReviewer(repo, pr, reviewer)
    return `${verb} review from @${reviewer} on PR #${pr}.`
  } catch (e) {
    return errorMessages.failed(e instanceof Error ? e.message : String(e))
  }
}

export const PrDashboardPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      pr_add_reviewer: tool({
        description:
          "Add a reviewer (or team) to a GitHub pull request. Use when the user wants to request a review from someone. Uses the Octokit REST API; the user is the authenticated actor.",
        args: {
          pr: tool.schema.number().describe("Pull request number"),
          reviewer: tool.schema
            .string()
            .describe(
              "GitHub username (e.g. 'octocat') or team slug (e.g. 'org/team-name')",
            ),
        },
        async execute(args, context) {
          return requestReview(
            context.directory ?? directory,
            args.pr,
            args.reviewer,
            "Requested",
          )
        },
      }),

      pr_rerequest_review: tool({
        description:
          "Re-request a review from a user (or team) on a GitHub pull request. Use when a reviewer has already reviewed and the author wants a fresh look, or when a previous review request was dismissed. Uses the Octokit REST API; the user is the authenticated actor.",
        args: {
          pr: tool.schema.number().describe("Pull request number"),
          reviewer: tool.schema
            .string()
            .describe(
              "GitHub username (e.g. 'octocat') or team slug (e.g. 'org/team-name')",
            ),
        },
        async execute(args, context) {
          return requestReview(
            context.directory ?? directory,
            args.pr,
            args.reviewer,
            "Re-requested",
          )
        },
      }),
    },
  }
}

export default PrDashboardPlugin
