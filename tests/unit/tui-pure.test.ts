import { describe, expect, test } from "bun:test"
import { BOT_ALIASES, displayLogin, ellipsize } from "../../plugins/domain/login"
import {
  classifyCI,
  classifyRowState,
  checkStatusGroups,
  commentThreadCounts,
  reviewSummary,
  reviewStatusGroups,
} from "../../plugins/domain/pr-status"
import { toHex } from "../../plugins/app/theme"
import { truncateTitle, formatAge } from "../../plugins/domain/format"
import type { PR } from "../../plugins/domain/types"
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
      reviewRequests: [{ login: "dana" }],
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
    }))).toEqual({ open: 2, resolved: 1 })
    expect(commentThreadCounts(makeTUIPR({ reviewThreads: null }))).toBeNull()
  })
})

describe("classifyRowState", () => {
  test("draft state takes precedence", () => {
    expect(classifyRowState(makeTUIPR({ isDraft: true, mergeable: "CONFLICTING" }))).toBe("draft")
  })
  test("conflicts are blocked", () => {
    expect(classifyRowState(makeTUIPR({ mergeable: "CONFLICTING" }))).toBe("blocked")
  })
  test("passing CI with no changes requested is ready", () => {
    expect(classifyRowState(makeTUIPR({ statusCheckRollup: { state: "SUCCESS" } }))).toBe("ready")
  })
  test("failed or pending CI is not ready", () => {
    expect(classifyRowState(makeTUIPR({ statusCheckRollup: { state: "FAILURE" } }))).toBe("default")
    expect(classifyRowState(makeTUIPR({ statusCheckRollup: { state: "PENDING" } }))).toBe("default")
  })
  test("changes requested is not ready", () => {
    expect(classifyRowState(makeTUIPR({
      statusCheckRollup: { state: "SUCCESS" },
      latestReviews: [{ author: { login: "alice" }, state: "CHANGES_REQUESTED" }],
    }))).toBe("default")
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
      reviewRequests: [{ login: "d" }, { login: "e" }],
    })
    const r = reviewSummary(pr)
    expect(r.approved).toBe(1)
    expect(r.changes).toBe(1)
    expect(r.commented).toBe(1)
    expect(r.pending).toBe(2)
    expect(r.approvedLogins).toEqual(["a"])
    expect(r.changesLogins).toEqual(["b"])
    expect(r.commentedLogins).toEqual(["c"])
    expect(r.pendingLogins).toEqual(["d", "e"])
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
    expect(r.approvedLogins).toEqual(["a", "b"])
  })

  test("handles null latestReviews and reviewRequests", () => {
    const r = reviewSummary(
      makeTUIPR({ latestReviews: null, reviewRequests: null }),
    )
    expect(r.approved).toBe(0)
    expect(r.pending).toBe(0)
    expect(r.approvedLogins).toEqual([])
    expect(r.pendingLogins).toEqual([])
  })

  test("filters empty login from reviewRequests", () => {
    const r = reviewSummary(
      makeTUIPR({
        reviewRequests: [{ login: "alice" }, { login: "" as any }, { login: "bob" }],
      }),
    )
    expect(r.pending).toBe(2)
    expect(r.pendingLogins).toEqual(["alice", "bob"])
  })
})

describe("reviewStatusGroups", () => {
  test("groups review outcomes for compact status badges", () => {
    const groups = reviewStatusGroups(makeTUIPR({
      latestReviews: [
        { author: { login: "alice" }, state: "APPROVED" },
        { author: { login: "bob" }, state: "CHANGES_REQUESTED" },
      ],
      reviewRequests: [{ login: "carol" }],
    }))
    expect(groups).toEqual([
      { status: "pass", count: 1 },
      { status: "fail", count: 1 },
      { status: "pending", count: 1 },
    ])
  })
})

describe("commentThreadCounts", () => {
  test("counts unresolved and resolved review threads separately", () => {
    expect(commentThreadCounts(makeTUIPR({
      reviewThreads: [
        { isResolved: false },
        { isResolved: true },
        { isResolved: false },
      ],
    }))).toEqual({ open: 2, resolved: 1 })
  })

  test("returns null when thread counts were not fetched", () => {
    expect(commentThreadCounts(makeTUIPR({ reviewThreads: null }))).toBeNull()
  })
})

describe("displayLogin", () => {
  test("returns known bot alias", () => {
    expect(displayLogin("dependabot")).toBe("dependabot")
    expect(displayLogin("renovate-bot")).toBe("renovate")
  })
  test("strips [bot] suffix and uses alias if known", () => {
    expect(displayLogin("dependabot[bot]")).toBe("dependabot")
    expect(displayLogin("renovate[bot]")).toBe("renovate")
  })
  test("strips -bot suffix and uses alias if known", () => {
    expect(displayLogin("dependabot-bot")).toBe("dependabot")
    expect(displayLogin("renovate-bot")).toBe("renovate")
  })
  test("strips [bot] but no alias — returns base", () => {
    expect(displayLogin("custom-thing[bot]")).toBe("custom-thing")
  })
  test("strips -bot but no alias — returns base", () => {
    expect(displayLogin("my-bot")).toBe("my")
  })
  test("returns login as-is for humans", () => {
    expect(displayLogin("alice")).toBe("alice")
    expect(displayLogin("Bob")).toBe("Bob")
  })
  test("is case-insensitive", () => {
    expect(displayLogin("DEPENDABOT")).toBe("dependabot")
    expect(displayLogin("Dependabot[Bot]")).toBe("dependabot")
  })
  test("exposes BOT_ALIASES map", () => {
    expect(BOT_ALIASES["dependabot"]).toBe("dependabot")
    expect(BOT_ALIASES["copilot"]).toBe("copilot")
  })
})

describe("ellipsize", () => {
  test("returns input unchanged when short enough", () => {
    expect(ellipsize("hello")).toBe("hello")
    expect(ellipsize("hello", 10)).toBe("hello")
  })
  test("ellipsizes when too long", () => {
    expect(ellipsize("a-very-long-name", 9)).toBe("a-ve…name")
  })
  test("uses default maxLen=9", () => {
    expect(ellipsize("dependabot")).toBe("depe…abot") // 10 chars > 9
    expect(ellipsize("dependabot-extra")).toBe("depe…xtra")
  })
  test("handles empty string", () => {
    expect(ellipsize("")).toBe("")
  })
  test("handles exact length", () => {
    expect(ellipsize("abcdefghi")).toBe("abcdefghi")
  })
})

describe("formatAge", () => {
  test("returns 'now' for very recent", () => {
    expect(formatAge(new Date().toISOString())).toBe("now")
  })
  test("returns minutes", () => {
    const d = new Date(Date.now() - 5 * 60_000)
    expect(formatAge(d.toISOString())).toBe("5m")
  })
  test("returns hours", () => {
    const d = new Date(Date.now() - 3 * 3600_000)
    expect(formatAge(d.toISOString())).toBe("3h")
  })
  test("returns days", () => {
    const d = new Date(Date.now() - 5 * 86_400_000)
    expect(formatAge(d.toISOString())).toBe("5d")
  })
  test("returns months", () => {
    const d = new Date(Date.now() - 90 * 86_400_000)
    expect(formatAge(d.toISOString())).toBe("3mo")
  })
  test("returns empty string for invalid input", () => {
    expect(formatAge("not-a-date")).toBe("")
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
