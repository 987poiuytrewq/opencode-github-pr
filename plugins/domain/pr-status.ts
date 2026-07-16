// PR status evaluation: CI classification, review rollup, ready-to-merge,
// age formatting. Pure functions over the TuiPR type.

import type { TuiPR } from "./types"

export function classifyCI(pr: TuiPR): "pass" | "fail" | "pending" | "none" {
  const checks = pr.statusCheckRollup ?? []
  if (checks.length === 0) return "none"
  let anyPending = false
  let anyFail = false
  for (const c of checks) {
    const v = c.conclusion ?? c.status ?? c.state ?? ""
    if (v === "SUCCESS") continue
    if (v === "FAILURE" || v === "ERROR" || v === "TIMED_OUT") anyFail = true
    else anyPending = true
  }
  if (anyFail) return "fail"
  if (anyPending) return "pending"
  return "pass"
}

export function reviewSummary(pr: TuiPR): {
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

export function missingReviewerCount(pr: TuiPR, required: number | null | undefined): number {
  if (required == null || required <= 0) return 0
  const r = reviewSummary(pr)
  return Math.max(0, required - r.approved - r.pending)
}

export function isReadyToMerge(pr: TuiPR, required: number | null | undefined): boolean {
  if (pr.isDraft) return false
  if (pr.mergeStateStatus === "CONFLICTING" || pr.mergeable === "CONFLICTING") return false
  if (pr.mergeStateStatus && pr.mergeStateStatus !== "CLEAN" && pr.mergeStateStatus !== "UNSTABLE") {
    if (pr.mergeStateStatus === "BLOCKED" || pr.mergeStateStatus === "BEHIND" || pr.mergeStateStatus === "DIRTY") return false
  }
  const ci = classifyCI(pr)
  if (ci === "fail" || ci === "pending") return false
  const r = reviewSummary(pr)
  if (r.changes > 0) return false
  if (required != null && required > 0) {
    if (r.approved < required) return false
  }
  return true
}

export function fmtAge(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  return `${Math.floor(d / 30)}mo`
}
