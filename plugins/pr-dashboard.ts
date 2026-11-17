import { Plugin } from "@opencode/plugin"
import type { Context as PluginContext } from "@opencode/plugin/promise/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { errorMessages } from "./domain/messages"
import { addPullRequestReviewer } from "./infra/loader"
import { detectRepo } from "./infra/git"
import type { Repo } from "./domain/types"

export function noRepoError(cwd: string): string {
  return `${errorMessages.noRepo} (${cwd})`
}

async function requestReview(
  cwd: string,
  pr: number,
  reviewer: string,
  verb: "Requested" | "Re-requested",
): Promise<string> {
  const repo: Repo | null = detectRepo(cwd)
  if (!repo) return noRepoError(cwd)
  try {
    await addPullRequestReviewer(repo, pr, reviewer)
    return `${verb} review from @${reviewer} on PR #${pr}.`
  } catch (e) {
    return errorMessages.failed(e instanceof Error ? e.message : String(e))
  }
}

async function executeReview(
  plugin: PluginContext,
  toolContext: ToolContext,
  input: unknown,
  verb: "Requested" | "Re-requested",
) {
  const args = input as { pr: number; reviewer: string }
  try {
    const session = await plugin.session.get({ sessionID: toolContext.sessionID })
    const directory = session.location.directory || plugin.location.directory
    return { content: await requestReview(directory, args.pr, args.reviewer, verb) }
  } catch (e) {
    return { content: errorMessages.failed(e instanceof Error ? e.message : String(e)) }
  }
}

export const PrDashboardPlugin = Plugin.define({
  id: "opencode-github-pr",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "pr_add_reviewer",
        description:
          "Add a reviewer (or team) to a GitHub pull request. Use when the user wants to request a review from someone. Uses the Octokit REST API; the user is the authenticated actor.",
        input: {
          type: "object",
          properties: {
            pr: { type: "integer", description: "Pull request number" },
            reviewer: {
              type: "string",
              description: "GitHub username (e.g. 'octocat') or team slug (e.g. 'org/team-name')",
            },
          },
          required: ["pr", "reviewer"],
          additionalProperties: false,
        },
        execute: (input, toolContext) => executeReview(ctx, toolContext, input, "Requested"),
      })

      editor.add({
        name: "pr_rerequest_review",
        description:
          "Re-request a review from a user (or team) on a GitHub pull request. Use when a reviewer has already reviewed and the author wants a fresh look, or when a previous review request was dismissed. Uses the Octokit REST API; the user is the authenticated actor.",
        input: {
          type: "object",
          properties: {
            pr: { type: "integer", description: "Pull request number" },
            reviewer: {
              type: "string",
              description: "GitHub username (e.g. 'octocat') or team slug (e.g. 'org/team-name')",
            },
          },
          required: ["pr", "reviewer"],
          additionalProperties: false,
        },
        execute: (input, toolContext) => executeReview(ctx, toolContext, input, "Re-requested"),
      })
    })
  },
})

export default PrDashboardPlugin
