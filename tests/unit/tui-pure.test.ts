import { describe, expect, test } from "bun:test"
import {
  classifyCI,
  checkStatusGroups,
  commentThreadCounts,
  mergeReadiness,
  reviewSummary,
  reviewStatusGroups,
} from "../../plugins/domain/pr-status"
import { toHex } from "../../plugins/app/theme"
import { truncateTitle } from "../../plugins/domain/format"
import { makeTUIPR } from "../helpers/tui-fixtures"


describe("classifyCI", () => {
  test("returns 'pass' for SUCCESS check state", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: { state: "SUCCESS" } }))).toBe("pass")
  })
  test("returns 'fail' for FAILURE check state", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: { state: "FAILURE" } }))).toBe("fail")
  })
  test("returns 'fail' for ERROR check state", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: { state: "ERROR" } }))).toBe("fail")
  })
  test("returns 'pending' for PENDING check state", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: { state: "PENDING" } }))).toBe("pending")
  })
  test("returns 'pending' for EXPECTED check state", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: { state: "EXPECTED" } }))).toBe("pending")
  })
  test("returns 'none' when no check state", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: null }))).toBe("none")
  })
  test("returns 'none' for an unknown check state", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: { state: "UNKNOWN" } }))).toBe("none")
  })
})

describe("status groups", () => {
  test("groups mixed checks by status and preserves single-status compact display data", () => {
    const mixed = makeTUIPR({ checkStatuses: ["SUCCESS", "SUCCESS", "FAILURE"] })
    expect(checkStatusGroups(mixed)).toEqual([
      { status: "pass", count: 2 },
      { status: "fail", count: 1 },
    ])
    expect(checkStatusGroups(makeTUIPR({ checkStatuses: ["SUCCESS", "SUCCESS"] }))).toEqual([
      { status: "pass", count: 2 },
    ])
  })

  test("groups reviews including pending requests and comment-only reviews", () => {
    const pr = makeTUIPR({
      latestReviews: [
        { author: { login: "alice" }, state: "APPROVED" },
        { author: { login: "bob" }, state: "CHANGES_REQUESTED" },
        { author: { login: "carol" }, state: "COMMENTED" },
      ],
      reviewRequests: [{ type: "user", login: "dana" }],
    })
    expect(reviewStatusGroups(pr)).toEqual([
      { status: "pass", count: 1 },
      { status: "fail", count: 1 },
      { status: "pending", count: 1 },
      { status: "neutral", count: 1 },
    ])
  })

  test("counts open and resolved review threads", () => {
    expect(commentThreadCounts(makeTUIPR({
      reviewThreads: [{ isResolved: false }, { isResolved: true }, { isResolved: false }],
    }))).toEqual({ open: 2, resolved: 1, truncated: false })
    expect(commentThreadCounts(makeTUIPR({
      reviewThreads: [{ isResolved: false }],
      reviewThreadsTruncated: true,
    }))).toEqual({ open: 1, resolved: 0, truncated: true })
    expect(commentThreadCounts(makeTUIPR({ reviewThreads: null }))).toBeNull()
  })
})

describe("mergeReadiness", () => {
  test("marks clean PRs green when reviews are approved or not required", () => {
    expect(mergeReadiness(makeTUIPR({ mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" }))).toBe("pass")
    expect(mergeReadiness(makeTUIPR({ mergeStateStatus: "CLEAN", reviewDecision: null }))).toBe("pass")
  })
  test("keeps a clean PR yellow while review is required and colors requested changes red", () => {
    expect(mergeReadiness(makeTUIPR({
      mergeStateStatus: "CLEAN",
      reviewDecision: "REVIEW_REQUIRED",
    }))).toBe("pending")
    expect(mergeReadiness(makeTUIPR({
      mergeStateStatus: "CLEAN",
      reviewDecision: "CHANGES_REQUESTED",
    }))).toBe("fail")
  })
  test("treats HAS_HOOKS like CLEAN for approved or unneeded reviews", () => {
    expect(mergeReadiness(makeTUIPR({ mergeStateStatus: "HAS_HOOKS", reviewDecision: "APPROVED" }))).toBe("pass")
    expect(mergeReadiness(makeTUIPR({ mergeStateStatus: "HAS_HOOKS", reviewDecision: null }))).toBe("pass")
    expect(mergeReadiness(makeTUIPR({ mergeStateStatus: "HAS_HOOKS", reviewDecision: "REVIEW_REQUIRED" }))).toBe("pending")
  })
  test("colors dirty red, blocked states yellow, and unknown states neutral", () => {
    expect(mergeReadiness(makeTUIPR({ mergeStateStatus: "DIRTY" }))).toBe("fail")
    for (const status of ["BLOCKED", "BEHIND", "UNSTABLE"]) {
      expect(mergeReadiness(makeTUIPR({ mergeStateStatus: status }))).toBe("pending")
    }
    expect(mergeReadiness(makeTUIPR({ mergeStateStatus: "UNKNOWN" }))).toBe("none")
  })
})

describe("reviewSummary", () => {
  test("counts approved changes-requested and commented", () => {
    const pr = makeTUIPR({
      latestReviews: [
        { author: { login: "a" }, state: "APPROVED" },
        { author: { login: "a" }, state: "APPROVED" },
        { author: { login: "b" }, state: "CHANGES_REQUESTED" },
        { author: { login: "c" }, state: "COMMENTED" },
      ],
      reviewRequests: [{ type: "user", login: "d" }, { type: "user", login: "e" }],
    })
    const r = reviewSummary(pr)
    expect(r.approved).toBe(1)
    expect(r.changes).toBe(1)
    expect(r.commented).toBe(1)
    expect(r.pending).toBe(2)
  })

  test("deduplicates by login within each state category", () => {
    const pr = makeTUIPR({
      latestReviews: [
        { author: { login: "a" }, state: "APPROVED" },
        { author: { login: "a" }, state: "APPROVED" },
        { author: { login: "b" }, state: "APPROVED" },
      ],
    })
    const r = reviewSummary(pr)
    expect(r.approved).toBe(2) // a, b (deduped)
  })

  test("a re-requested reviewer is counted only as pending", () => {
    const r = reviewSummary(makeTUIPR({
      latestReviews: [
        { author: { login: "alice" }, state: "APPROVED" },
        { author: { login: "bob" }, state: "COMMENTED" },
      ],
      reviewRequests: [{ type: "user", login: "Alice" }, { type: "user", login: "carol" }],
    }))
    expect(r).toEqual({ approved: 0, changes: 0, pending: 2, commented: 1 })
  })

  test("counts pending team requests separately from user logins", () => {
    const r = reviewSummary(makeTUIPR({
      latestReviews: [{ author: { login: "platform" }, state: "APPROVED" }],
      reviewRequests: [
        { type: "user", login: "platform" },
        { type: "team", slug: "platform" },
        { type: "team", slug: "platform" },
        { type: "team", slug: "frontend" },
      ],
    }))
    expect(r).toEqual({ approved: 0, changes: 0, pending: 3, commented: 0 })
  })

  test("handles null latestReviews and reviewRequests", () => {
    const r = reviewSummary(
      makeTUIPR({ latestReviews: null, reviewRequests: null }),
    )
    expect(r.approved).toBe(0)
    expect(r.pending).toBe(0)
  })

  test("filters empty login from reviewRequests", () => {
    const r = reviewSummary(
      makeTUIPR({
        reviewRequests: [
          { type: "user", login: "alice" },
          { type: "user", login: "" as any },
          { type: "user", login: "bob" },
        ],
      }),
    )
    expect(r.pending).toBe(2)
  })
})

describe("toHex", () => {
  test("converts RGB ints to hex", () => {
    expect(toHex({ toInts: () => [255, 0, 0, 255] })).toBe("#ff0000")
    expect(toHex({ toInts: () => [0, 255, 0, 255] })).toBe("#00ff00")
    expect(toHex({ toInts: () => [0, 0, 255, 255] })).toBe("#0000ff")
  })
  test("pads single-digit components", () => {
    expect(toHex({ toInts: () => [1, 2, 3, 255] })).toBe("#010203")
  })
  test("clamps out-of-range values", () => {
    expect(toHex({ toInts: () => [300, -10, 128, 255] })).toBe("#ff0080")
  })
  test("handles zero", () => {
    expect(toHex({ toInts: () => [0, 0, 0, 255] })).toBe("#000000")
  })
})

describe("truncateTitle", () => {
  test("returns title unchanged when short enough", () => {
    expect(truncateTitle("Short", 12)).toBe("Short")
  })
  test("truncates long titles at the previous word boundary", () => {
    expect(truncateTitle("The title continues past this point", 24)).toBe("The title continues…")
  })
  test("prefers a complete word over a longer partial-word prefix", () => {
    expect(truncateTitle("first incomplete", 12)).toBe("first…")
  })
  test("truncates a single word when there is no earlier word boundary", () => {
    expect(truncateTitle("supercalifragilistic", 8)).toBe("superca…")
  })
  test("truncates to terminal-cell width for wide characters", () => {
    const title = truncateTitle("Fix界界界界界", 8)
    expect(title).toBe("Fix界界…")
    expect(Bun.stringWidth(title)).toBeLessThanOrEqual(8)
  })
  test("normalizes embedded whitespace so titles stay on one line", () => {
    expect(truncateTitle("A title\nwith\tline breaks", 40)).toBe("A title with line breaks")
  })
  test("never returns a value wider than the requested terminal-cell width", () => {
    const title = truncateTitle("A title longer than the limit", 8)
    expect(Bun.stringWidth(title)).toBeLessThanOrEqual(8)
  })
})
