// Presentation helper for reviewer threads: turns a list of ReviewThread
// records (produced by infra/loader.fetchReviewerThreads) into a markdown
// table suitable for posting into opencode chat. Kept here so the formatter
// is testable without an Octokit mock.

import type { ReviewThread } from "./types"

export function formatReviewerThreads(
  threads: ReviewThread[],
  reviewerLogin: string,
  prNumber: number,
): string {
  if (threads.length === 0) {
    return `_No unresolved comments from @${reviewerLogin} on #${prNumber}_`
  }
  const header = `| File | Line | Comment | Date |\n|------|------|---------|------|`
  const rows = threads.map((t) => {
    const file = t.path ?? "—"
    const line = t.line != null ? String(t.line) : "—"
    const body = (t.body ?? "").slice(0, 200)
    const date = t.createdAt?.slice(0, 10) ?? "—"
    return `| \`${file}\` | ${line} | ${body} | ${date} |`
  })
  return `Unresolved comments from @${reviewerLogin} on #${prNumber}:\n\n${header}\n${rows.join("\n")}`
}
