import { tool, type Plugin, type Shell } from "@opencode-ai/plugin"

export type PR = {
  number: number
  title: string
  author: { login: string } | null
  headRefName: string
  baseRefName: string
  url: string
  createdAt: string
  isDraft: boolean
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  statusCheckRollup: {
    state: "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | null
    contexts?: { name?: string; state?: string }[]
  } | null
  reviews?: { author: { login: string }; state: string }[]
  comments?: { totalCount: number }[]
  latestReviews?: { author: { login: string }; state: string }[]
}

export const JSON_FIELDS = [
  "number",
  "title",
  "author",
  "headRefName",
  "baseRefName",
  "url",
  "createdAt",
  "isDraft",
  "mergeable",
  "reviewDecision",
  "statusCheckRollup",
  "reviews",
  "comments",
].join(",")

export async function detectRepo($: Shell, cwd: string): Promise<string | null> {
  try {
    const out = await $`gh repo view --json nameWithOwner -q .nameWithOwner`
      .cwd(cwd)
      .text()
    const trimmed = out.trim()
    const [owner, repo] = trimmed.split("/")
    return owner && repo ? `${owner}/${repo}` : null
  } catch {
    return null
  }
}

export async function listOpenPRs($: Shell, author: "me" | "any"): Promise<PR[]> {
  const authorFlag = author === "me" ? ["--author", "@me"] : []
  const out = await $`gh pr list --state open --json ${JSON_FIELDS} --limit 50 ${authorFlag}`
    .text()
  return JSON.parse(out) as PR[]
}

export function ciBadge(pr: PR): string {
  const state = pr.statusCheckRollup?.state ?? null
  if (state === "SUCCESS") return "✓"
  if (state === "FAILURE") return "✗"
  if (state === "PENDING") return "●"
  return "—"
}

export function reviewBadge(pr: PR): string {
  const reviews = pr.reviews ?? []
  const approved = reviews.filter((r) => r.state === "APPROVED").length
  const changes = reviews.filter((r) => r.state === "CHANGES_REQUESTED").length
  return `✓${approved} ✗${changes}`
}

export function formatDashboard(
  repo: string,
  prs: PR[],
  author: "me" | "any",
): { text: string } {
  const lines: string[] = []
  lines.push(`# PR Dashboard — ${repo}`)
  lines.push(
    author === "me"
      ? "Filter: PRs I authored"
      : "Filter: all open PRs",
  )
  lines.push("")
  if (prs.length === 0) {
    lines.push("No open PRs.")
    return { text: lines.join("\n") }
  }
  lines.push(
    "CI  Review           PR   Title                                       Author         Branch                              Age",
  )
  for (const pr of prs) {
    const ci = ciBadge(pr).padEnd(3)
    const rev = reviewBadge(pr).padEnd(16)
    const num = `#${pr.number}`.padEnd(4)
    const title = pr.title.slice(0, 42).padEnd(42)
    const login = (pr.author?.login ?? "?").slice(0, 14).padEnd(14)
    const branch = `${pr.headRefName} → ${pr.baseRefName}`.slice(0, 34).padEnd(34)
    const age = ageOf(pr.createdAt)
    lines.push(`${ci} ${rev} ${num} ${title} ${login} ${branch} ${age}`)
  }
  return { text: lines.join("\n") }
}

export function ageOf(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime()
  const days = Math.floor(ms / 86400000)
  if (days >= 1) return `${days}d`
  const hours = Math.floor(ms / 3600000)
  if (hours >= 1) return `${hours}h`
  return "<1h"
}

export function noRepoError(cwd: string): string {
  return `Error: not a GitHub repository (no remote detected) at ${cwd}. Run \`gh repo view\` to verify.`
}

export function ghListError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return `Error: failed to list PRs: ${msg}`
}

export const PrDashboardPlugin: Plugin = async ({ $, directory }) => {
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
