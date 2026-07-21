import { describe, expect, test } from "bun:test"
import { formatReviewerThreads } from "../../plugins/domain/reviewers"
import type { ReviewThread } from "../../plugins/domain/types"

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    isResolved: false,
    author: "alice",
    body: "Looks good but check this",
    createdAt: "2024-01-15T10:00:00Z",
    path: "src/foo.ts",
    line: 42,
    ...overrides,
  }
}

describe("formatReviewerThreads", () => {
  test("returns a no-comments message when threads is empty", () => {
    const out = formatReviewerThreads([], "alice", 1)
    expect(out).toBe("_No unresolved comments from @alice on #1_")
  })

  test("renders a markdown table with one row per thread", () => {
    const out = formatReviewerThreads([makeThread()], "alice", 1)
    expect(out).toContain("Unresolved comments from @alice on #1")
    expect(out).toContain("| File | Line | Comment | Date |")
    expect(out).toContain("|------|------|---------|------|")
    expect(out).toContain("`src/foo.ts`")
    expect(out).toContain("| 42 |")
    expect(out).toContain("Looks good but check this")
    expect(out).toContain("2024-01-15")
  })

  test("renders multiple rows in order", () => {
    const threads = [
      makeThread({ path: "a.ts", line: 1, body: "first" }),
      makeThread({ path: "b.ts", line: 2, body: "second" }),
    ]
    const out = formatReviewerThreads(threads, "alice", 7)
    const rows = out.split("\n").filter((l) => l.startsWith("| `"))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain("a.ts")
    expect(rows[1]).toContain("b.ts")
    expect(out).toContain("#7")
  })

  test("truncates body to 200 chars", () => {
    const long = "x".repeat(300)
    const out = formatReviewerThreads([makeThread({ body: long })], "alice", 1)
    expect(out).toContain("x".repeat(200))
    expect(out).not.toContain("x".repeat(201))
  })

  test("handles null line with em dash", () => {
    const out = formatReviewerThreads([makeThread({ line: null })], "alice", 1)
    expect(out).toContain("| — |")
  })

  test("handles missing path with em dash", () => {
    const out = formatReviewerThreads([makeThread({ path: "—" })], "alice", 1)
    expect(out).toContain("`—`")
  })
})
