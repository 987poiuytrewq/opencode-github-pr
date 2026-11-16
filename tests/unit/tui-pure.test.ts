import { describe, expect, test } from "bun:test"
import { BOT_ALIASES, displayLogin, ellipsize } from "../../plugins/domain/login"
import {
  classifyCI,
  classifyRowState,
  reviewSummary,
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
    expect(truncateTitle("Short", 2)).toBe("Short")
  })
  test("truncates long titles", () => {
    const long = "This is a very long PR title that should be truncated"
    const out = truncateTitle(long, 3)
    expect(out.length).toBeLessThan(long.length)
    expect(out.endsWith("…")).toBe(true)
  })
  test("respects minimum budget of 8", () => {
    expect(truncateTitle("hi", 0)).toBe("hi")
  })
  test("truncates when over budget", () => {
    const long = "x".repeat(50)
    const out = truncateTitle(long, 0)
    expect(out.length).toBeLessThan(long.length)
    expect(out.endsWith("…")).toBe(true)
  })
  test("budget decreases with wider numbers", () => {
    const a = truncateTitle("aaaaaaaaaa", 2)
    const b = truncateTitle("aaaaaaaaaa", 5)
    expect(b.length).toBeLessThanOrEqual(a.length)
  })
})
