// PR status evaluation: CI classification and review rollup.
// Pure functions over the PR type. Age formatting lives in ./format.

import type { PR } from "./types"

export type StatusCategory = "pass" | "fail" | "pending" | "neutral" | "none"
export type StatusGroup = { status: StatusCategory; count: number }

// Row color: draft → grey, merge conflict → red, ready to merge → green,
// otherwise → "default" (white/text).
export function classifyRowState(pr: PR): "draft" | "blocked" | "ready" | "default" {
  if (pr.isDraft) return "draft"
  if (pr.mergeable === "CONFLICTING") return "blocked"
  const ci = classifyCI(pr)
  const r = reviewSummary(pr)
  if (ci === "pass" && r.changes === 0) return "ready"
  return "default"
}

export function classifyCI(pr: PR): "pass" | "fail" | "pending" | "none" {
  const state = pr.statusCheckRollup?.state
  if (state === "SUCCESS") return "pass"
  if (state === "FAILURE" || state === "ERROR") return "fail"
  if (state === "PENDING" || state === "EXPECTED") return "pending"
  return "none"
}

function classifyCheckStatus(state: string): Exclude<StatusCategory, "none"> {
  switch (state.toUpperCase()) {
    case "SUCCESS":
      return "pass"
    case "FAILURE":
    case "ERROR":
    case "ACTION_REQUIRED":
    case "CANCELLED":
    case "STARTUP_FAILURE":
    case "TIMED_OUT":
      return "fail"
    case "EXPECTED":
    case "IN_PROGRESS":
    case "PENDING":
    case "QUEUED":
    case "REQUESTED":
    case "WAITING":
      return "pending"
    default:
      return "neutral"
  }
}

const statusOrder: StatusCategory[] = ["pass", "fail", "pending", "neutral", "none"]

function orderedGroups(counts: Map<StatusCategory, number>): StatusGroup[] {
  return statusOrder
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => ({ status, count: counts.get(status)! }))
}

export function checkStatusGroups(pr: PR): StatusGroup[] {
  const contexts = (pr.checkStatuses ?? []).filter(Boolean)
  if (contexts.length === 0) {
    const status = classifyCI(pr)
    return [{ status, count: status === "none" ? 0 : 1 }]
  }

  const counts = new Map<StatusCategory, number>()
  for (const context of contexts) {
    const status = classifyCheckStatus(context)
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return orderedGroups(counts)
}

export function reviewStatusGroups(pr: PR): StatusGroup[] {
  const summary = reviewSummary(pr)
  return orderedGroups(new Map<StatusCategory, number>([
    ["pass", summary.approved],
    ["fail", summary.changes],
    ["pending", summary.pending],
    ["neutral", summary.commented],
  ]))
}

export function commentThreadCounts(pr: PR): { open: number; resolved: number } | null {
  if (pr.reviewThreads === null) return null
  return pr.reviewThreads.reduce(
    (counts, thread) => {
      if (thread.isResolved) counts.resolved++
      else counts.open++
      return counts
    },
    { open: 0, resolved: 0 },
  )
}

export function reviewSummary(pr: PR): {
  approved: number
  changes: number
  pending: number
  commented: number
  approvedLogins: string[]
  changesLogins: string[]
  pendingLogins: string[]
  commentedLogins: string[]
} {
  const approved = new Set<string>()
  const changes = new Set<string>()
  const commented = new Set<string>()
  for (const r of pr.latestReviews ?? []) {
    const login = r.author?.login
    if (!login) continue
    if (r.state === "APPROVED") approved.add(login)
    else if (r.state === "CHANGES_REQUESTED") changes.add(login)
    else if (r.state === "COMMENTED") commented.add(login)
  }
  const pendingLogins = (pr.reviewRequests ?? []).map((r) => r.login).filter(Boolean)
  return {
    approved: approved.size,
    changes: changes.size,
    pending: pendingLogins.length,
    commented: commented.size,
    approvedLogins: Array.from(approved),
    changesLogins: Array.from(changes),
    pendingLogins,
    commentedLogins: Array.from(commented),
  }
}
