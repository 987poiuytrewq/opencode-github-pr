import { Plugin } from "@opencode/plugin"
import type { Context as PluginContext } from "@opencode/plugin/promise/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { errorMessages } from "./domain/messages"
import { addPullRequestReviewer } from "./infra/loader"
import { detectRepo } from "./infra/git"
import type { Repo } from "./domain/types"
import { parseReviewerTarget } from "./domain/reviewer-target"

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
  if (!Number.isInteger(pr) || pr < 1) return "Invalid pull request number: expected a positive integer."
  if (!parseReviewerTarget(reviewer, repo)) {
    return `Invalid reviewer: expected a GitHub login or a team in ${repo.owner}/team format.`
  }
  try {
    await addPullRequestReviewer(repo, pr, reviewer)
    return `${verb} review from @${reviewer} on PR #${pr}.`
  } catch (e: unknown) {
    return errorMessages.failed(e instanceof Error ? e.message : String(e))
  }
}

function parseReviewInput(input: unknown): { pr: number; reviewer: string } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (
    typeof value.pr !== "number" ||
    !Number.isInteger(value.pr) ||
    value.pr < 1 ||
    typeof value.reviewer !== "string"
  ) {
    return null
  }
  return { pr: value.pr, reviewer: value.reviewer }
}

async function executeReview(
  plugin: PluginContext,
  toolContext: ToolContext,
  input: unknown,
  verb: "Requested" | "Re-requested",
) {
  const args = parseReviewInput(input)
  if (!args) return { content: "Invalid input: provide a positive pull request number and reviewer." }
  try {
    const session = await plugin.session.get({ sessionID: toolContext.sessionID })
    const directory = session.location.directory || plugin.location.directory
    return { content: await requestReview(directory, args.pr, args.reviewer, verb) }
  } catch (e: unknown) {
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
            pr: { type: "integer", minimum: 1, description: "Positive pull request number" },
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
            pr: { type: "integer", minimum: 1, description: "Positive pull request number" },
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
