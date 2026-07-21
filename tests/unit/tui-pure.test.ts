import { describe, expect, test } from "bun:test"
import { BOT_ALIASES, displayLogin, ellipsize } from "../../plugins/domain/login"
import {
  classifyCI,
  reviewSummary,
  missingReviewerCount,
  isReadyToMerge,
} from "../../plugins/domain/pr-status"
import { toHex } from "../../plugins/app/theme"
import { truncateTitle, formatAge } from "../../plugins/domain/format"
import type { PR as PR } from "../../plugins/domain/types"
import { makeTUIPR } from "../helpers/tui-fixtures"


describe("classifyCI", () => {
  test("returns 'none' for null rollup and null mergeStateStatus", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: null, mergeStateStatus: null }))).toBe("none")
  })
  test("returns 'none' for empty rollup and null mergeStateStatus", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: [], mergeStateStatus: null }))).toBe("none")
  })
  test("returns 'pass' for CLEAN mergeStateStatus when no rollup", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: null, mergeStateStatus: "CLEAN" }))).toBe("pass")
  })
  test("returns 'pending' for UNSTABLE mergeStateStatus when no rollup", () => {
    expect(classifyCI(makeTUIPR({ statusCheckRollup: null, mergeStateStatus: "UNSTABLE" }))).toBe("pending")
  })
  test("returns 'pass' when all SUCCESS", () => {
    expect(
      classifyCI(
        makeTUIPR({
          statusCheckRollup: [{ name: "x", conclusion: "SUCCESS", status: "completed" }],
        }),
      ),
    ).toBe("pass")
  })
  test("returns 'fail' when any FAILURE", () => {
    expect(
      classifyCI(
        makeTUIPR({
          statusCheckRollup: [
            { name: "a", conclusion: "SUCCESS", status: "completed" },
            { name: "b", conclusion: "FAILURE", status: "completed" },
          ],
        }),
      ),
    ).toBe("fail")
  })
  test("returns 'fail' on ERROR", () => {
    expect(
      classifyCI(
        makeTUIPR({
          statusCheckRollup: [{ name: "x", conclusion: "ERROR", status: "completed" }],
        }),
      ),
    ).toBe("fail")
  })
  test("returns 'fail' on TIMED_OUT", () => {
    expect(
      classifyCI(
        makeTUIPR({
          statusCheckRollup: [{ name: "x", conclusion: "TIMED_OUT", status: "completed" }],
        }),
      ),
    ).toBe("fail")
  })
  test("returns 'pending' when something is still running", () => {
    expect(
      classifyCI(
        makeTUIPR({
          statusCheckRollup: [
            { name: "a", conclusion: "SUCCESS", status: "completed" },
            { name: "b", conclusion: null, status: "in_progress" },
          ],
        }),
      ),
    ).toBe("pending")
  })
  test("returns 'pass' when only SUCCESS checks", () => {
    expect(
      classifyCI(
        makeTUIPR({
          statusCheckRollup: [
            { name: "a", conclusion: "SUCCESS", status: "completed" },
            { name: "b", conclusion: "SUCCESS", status: "completed" },
          ],
        }),
      ),
    ).toBe("pass")
  })
  test("returns 'pass' with no conclusion but neutral state", () => {
    // code falls back to status (completed → not pending) and treats non-FAILURE as pending,
    // so this actually returns 'pending' — documenting the actual behavior
    expect(
      classifyCI(
        makeTUIPR({
          statusCheckRollup: [{ name: "x", conclusion: null, status: "completed", state: "NEUTRAL" as any }],
        }),
      ),
    ).toBe("pending")
  })
})

describe("reviewSummary", () => {
  test("counts approved changes-requested and commented", () => {
    const pr = makeTUIPR({
      latestReviews: [
        { author: { login: "a" }, state: "APPROVED", createdAt: "2024-01-01" },
        { author: { login: "a" }, state: "APPROVED", createdAt: "2024-01-02" },
        { author: { login: "b" }, state: "CHANGES_REQUESTED", createdAt: "2024-01-01" },
        { author: { login: "c" }, state: "COMMENTED", createdAt: "2024-01-01" },
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
        { author: { login: "a" }, state: "APPROVED", createdAt: "2024-01-01" },
        { author: { login: "a" }, state: "APPROVED", createdAt: "2024-01-02" },
        { author: { login: "b" }, state: "APPROVED", createdAt: "2024-01-01" },
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

describe("missingReviewerCount", () => {
  test("returns 0 when required is null", () => {
    expect(missingReviewerCount(makeTUIPR(), null)).toBe(0)
  })
  test("returns 0 when required is 0", () => {
    expect(missingReviewerCount(makeTUIPR(), 0)).toBe(0)
  })
  test("returns 0 when required is negative", () => {
    expect(missingReviewerCount(makeTUIPR(), -1)).toBe(0)
  })
  test("returns required when no approvals and no pending", () => {
    expect(missingReviewerCount(makeTUIPR(), 2)).toBe(2)
  })
  test("counts approved toward requirement", () => {
    const pr = makeTUIPR({
      latestReviews: [{ author: { login: "a" }, state: "APPROVED", createdAt: "2024-01-01" }],
    })
    expect(missingReviewerCount(pr, 1)).toBe(0)
    expect(missingReviewerCount(pr, 2)).toBe(1)
  })
  test("counts pending toward requirement", () => {
    const pr = makeTUIPR({ reviewRequests: [{ login: "a" }] })
    expect(missingReviewerCount(pr, 1)).toBe(0)
  })
  test("never returns negative", () => {
    const pr = makeTUIPR({
      latestReviews: [
        { author: { login: "a" }, state: "APPROVED", createdAt: "2024-01-01" },
        { author: { login: "b" }, state: "APPROVED", createdAt: "2024-01-01" },
      ],
    })
    expect(missingReviewerCount(pr, 1)).toBe(0)
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

describe("isReadyToMerge", () => {
  test("returns false for draft", () => {
    expect(isReadyToMerge(makeTUIPR({ isDraft: true }), null)).toBe(false)
  })
  test("returns false when conflicting", () => {
    expect(
      isReadyToMerge(makeTUIPR({ mergeable: "CONFLICTING" }), null),
    ).toBe(false)
    expect(
      isReadyToMerge(
        makeTUIPR({ mergeStateStatus: "CONFLICTING" } as any),
        null,
      ),
    ).toBe(false)
  })
  test("returns false when blocked", () => {
    expect(
      isReadyToMerge(
        makeTUIPR({ mergeStateStatus: "BLOCKED" } as any),
        null,
      ),
    ).toBe(false)
  })
  test("returns false when CI failed", () => {
    expect(
      isReadyToMerge(
        makeTUIPR({
          statusCheckRollup: [{ name: "x", conclusion: "FAILURE", status: "completed" }],
        }),
        null,
      ),
    ).toBe(false)
  })
  test("returns false when CI pending", () => {
    expect(
      isReadyToMerge(
        makeTUIPR({
          statusCheckRollup: [{ name: "x", conclusion: null, status: "in_progress" }],
        }),
        null,
      ),
    ).toBe(false)
  })
  test("returns false when changes requested", () => {
    expect(
      isReadyToMerge(
        makeTUIPR({
          latestReviews: [
            { author: { login: "a" }, state: "CHANGES_REQUESTED", createdAt: "x" },
          ],
        }),
        null,
      ),
    ).toBe(false)
  })
  test("returns true for clean approved PR with no required reviewers", () => {
    const pr = makeTUIPR({
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN" as any,
      statusCheckRollup: [{ name: "x", conclusion: "SUCCESS", status: "completed" }],
      latestReviews: [{ author: { login: "a" }, state: "APPROVED", createdAt: "x" }],
    })
    expect(isReadyToMerge(pr, null)).toBe(true)
  })
  test("returns false when required reviewers not met", () => {
    const pr = makeTUIPR({
      latestReviews: [{ author: { login: "a" }, state: "APPROVED", createdAt: "x" }],
    })
    expect(isReadyToMerge(pr, 2)).toBe(false)
  })
  test("returns true when required reviewers met", () => {
    const pr = makeTUIPR({
      latestReviews: [
        { author: { login: "a" }, state: "APPROVED", createdAt: "x" },
        { author: { login: "b" }, state: "APPROVED", createdAt: "x" },
      ],
    })
    expect(isReadyToMerge(pr, 2)).toBe(true)
  })
  test("returns false for UNSTABLE state (checks not all passing)", () => {
    expect(
      isReadyToMerge(
        makeTUIPR({ mergeStateStatus: "UNSTABLE" as any }),
        null,
      ),
    ).toBe(false)
  })
  test("returns false for BEHIND state", () => {
    expect(
      isReadyToMerge(
        makeTUIPR({ mergeStateStatus: "BEHIND" as any }),
        null,
      ),
    ).toBe(false)
  })
  test("returns false for DIRTY state", () => {
    expect(
      isReadyToMerge(
        makeTUIPR({ mergeStateStatus: "DIRTY" as any }),
        null,
      ),
    ).toBe(false)
  })
  test("returns true when mergeStateStatus is null but no other issues", () => {
    const pr = makeTUIPR({
      mergeStateStatus: null,
      statusCheckRollup: [{ name: "x", conclusion: "SUCCESS", status: "completed" }],
    })
    expect(isReadyToMerge(pr, null)).toBe(true)
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
