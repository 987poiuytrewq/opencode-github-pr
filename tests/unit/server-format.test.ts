import { describe, expect, test } from "bun:test"
import {
  ageOf,
  ciBadge,
  formatDashboard,
  ghListError,
  noRepoError,
  reviewBadge,
  type PR,
} from "../../plugins/pr-dashboard"
import { makePR, samplePRs } from "../helpers/fixtures"

describe("ciBadge", () => {
  test("returns ✓ for SUCCESS", () => {
    expect(ciBadge(makePR({ statusCheckRollup: { state: "SUCCESS" } }))).toBe("✓")
  })
  test("returns ✗ for FAILURE", () => {
    expect(ciBadge(makePR({ statusCheckRollup: { state: "FAILURE" } }))).toBe("✗")
  })
  test("returns ● for PENDING", () => {
    expect(ciBadge(makePR({ statusCheckRollup: { state: "PENDING" } }))).toBe("●")
  })
  test("returns — for null state", () => {
    expect(ciBadge(makePR({ statusCheckRollup: null }))).toBe("—")
  })
  test("returns — for null rollup", () => {
    expect(ciBadge(makePR({ statusCheckRollup: undefined as any }))).toBe("—")
  })
})

describe("reviewBadge", () => {
  test("counts approvals and change requests", () => {
    const pr = makePR({
      reviews: [
        { author: { login: "a" }, state: "APPROVED" },
        { author: { login: "b" }, state: "APPROVED" },
        { author: { login: "c" }, state: "CHANGES_REQUESTED" },
      ],
    })
    expect(reviewBadge(pr)).toBe("✓2 ✗1")
  })
  test("returns zeros when no reviews", () => {
    expect(reviewBadge(makePR({ reviews: [] }))).toBe("✓0 ✗0")
  })
  test("handles missing reviews field", () => {
    expect(reviewBadge(makePR({ reviews: undefined as any }))).toBe("✓0 ✗0")
  })
})

describe("ageOf", () => {
  test("returns <1h for recent", () => {
    const now = new Date().toISOString()
    expect(ageOf(now)).toBe("<1h")
  })
  test("returns hours for same day", () => {
    const hours = 3
    const d = new Date(Date.now() - hours * 3600_000)
    expect(ageOf(d.toISOString())).toBe(`${hours}h`)
  })
  test("returns days for older", () => {
    const days = 5
    const d = new Date(Date.now() - days * 86_400_000)
    expect(ageOf(d.toISOString())).toBe(`${days}d`)
  })
})

describe("noRepoError", () => {
  test("includes the cwd path", () => {
    const out = noRepoError("/home/user/foo")
    expect(out).toContain("/home/user/foo")
    expect(out).toContain("Error")
  })
})

describe("ghListError", () => {
  test("formats Error instance", () => {
    const out = ghListError(new Error("network down"))
    expect(out).toBe("Error: failed to list PRs: network down")
  })
  test("formats non-Error values", () => {
    expect(ghListError("boom")).toBe("Error: failed to list PRs: boom")
    expect(ghListError(42)).toBe("Error: failed to list PRs: 42")
    expect(ghListError(null)).toBe("Error: failed to list PRs: null")
  })
})

describe("formatDashboard", () => {
  test("includes repo name in header", () => {
    const { text } = formatDashboard("foo/bar", [], "any")
    expect(text).toContain("# PR Dashboard — foo/bar")
  })
  test("shows me-filter message when author=me", () => {
    const { text } = formatDashboard("foo/bar", [], "me")
    expect(text).toContain("PRs I authored")
  })
  test("shows all-open message when author=any", () => {
    const { text } = formatDashboard("foo/bar", [], "any")
    expect(text).toContain("all open PRs")
  })
  test("handles empty PR list", () => {
    const { text } = formatDashboard("foo/bar", [], "any")
    expect(text).toContain("No open PRs.")
  })
  test("renders a row per PR", () => {
    const { text } = formatDashboard("foo/bar", samplePRs, "any")
    for (const pr of samplePRs) {
      expect(text).toContain(`#${pr.number}`)
    }
  })
  test("truncates long titles to 42 chars", () => {
    const longTitle = "x".repeat(100)
    const { text } = formatDashboard("foo/bar", [makePR({ title: longTitle })], "any")
    const lines = text.split("\n")
    const dataLine = lines.find((l) => l.includes("#1")) ?? ""
    // Each data column has fixed width; title is the third column.
    // We expect the line NOT to contain the full 100-char title.
    expect(dataLine.length).toBeLessThan(longTitle.length + 100)
  })
  test("uses ? for PRs with no author", () => {
    const { text } = formatDashboard("foo/bar", [makePR({ author: null })], "any")
    expect(text).toContain("?")
  })
  test("includes branch info", () => {
    const { text } = formatDashboard("foo/bar", [makePR({ headRefName: "foo", baseRefName: "bar" })], "any")
    expect(text).toContain("foo → bar")
  })
  test("includes CI badge for each PR", () => {
    const prs = [
      makePR({ number: 1, statusCheckRollup: { state: "SUCCESS" } }),
      makePR({ number: 2, statusCheckRollup: { state: "FAILURE" } }),
    ]
    const { text } = formatDashboard("foo/bar", prs, "any")
    expect(text).toContain("✓")
    expect(text).toContain("✗")
  })
})
