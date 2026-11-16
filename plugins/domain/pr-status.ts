// PR status evaluation: CI classification and review rollup.
// Pure functions over the PR type. Age formatting lives in ./format.

import type { PR } from "./types"

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
