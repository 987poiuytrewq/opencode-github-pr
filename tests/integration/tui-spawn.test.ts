import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  clearSpawnMocks,
  installSpawnMock,
  mockSpawn,
  mockSpawnSequence,
} from "../helpers/spawn-mock"
import { makeTUIPR, sampleTUIPRs } from "../helpers/tui-fixtures"

installSpawnMock()

// Dynamic import AFTER mock registration so the source picks up our mock.
const tui = await import("../../plugins/pr-dashboard.tui")
const {
  currentBranchPR,
  detectRepo,
  fetchBranchRequiredReviews,
  fetchCurrentUser,
  fetchOrgMembers,
  fetchPRs,
  fetchReviewerThreadCounts,
  fetchReviewerThreads,
  runGh,
} = tui

beforeEach(() => {
  clearSpawnMocks()
})

afterEach(() => {
  clearSpawnMocks()
})

describe("runGh", () => {
  test("returns ok=true and output on success", async () => {
    mockSpawn(() => ({ stdout: "hello world\n" }))
    const res = await runGh(["gh", "api", "user"])
    expect(res.ok).toBe(true)
    expect(res.output).toBe("hello world")
    expect(res.error).toBeUndefined()
  })

  test("returns ok=false and error message on failure", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "auth required\n" }))
    const res = await runGh(["gh", "api", "user"])
    expect(res.ok).toBe(false)
    expect(res.error).toBe("auth required")
  })

  test("uses exit code message when stderr is empty", async () => {
    mockSpawn(() => ({ exitCode: 127 }))
    const res = await runGh(["gh", "nope"])
    expect(res.ok).toBe(false)
    expect(res.error).toBe("gh exited 127")
  })

  test("trims trailing whitespace from output", async () => {
    mockSpawn(() => ({ stdout: "  trimmed  \n\n" }))
    const res = await runGh(["gh", "x"])
    expect(res.output).toBe("trimmed")
  })
})

describe("detectRepo", () => {
  test("returns owner/repo on success", async () => {
    mockSpawn(() => ({ stdout: "foo/bar\n" }))
    expect(await detectRepo()).toEqual({ owner: "foo", repo: "bar" })
  })

  test("returns null on gh failure", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "not a git repo" }))
    expect(await detectRepo()).toBeNull()
  })

  test("returns null when output is missing slash", async () => {
    mockSpawn(() => ({ stdout: "no-slash" }))
    expect(await detectRepo()).toBeNull()
  })

  test("returns null on empty output", async () => {
    mockSpawn(() => ({ stdout: "" }))
    expect(await detectRepo()).toBeNull()
  })

  test("returns null on whitespace-only output", async () => {
    mockSpawn(() => ({ stdout: "   " }))
    expect(await detectRepo()).toBeNull()
  })
})

describe("fetchPRs", () => {
  test("parses JSON array on success", async () => {
    mockSpawn(() => ({ stdout: JSON.stringify(sampleTUIPRs) }))
    const prs = await fetchPRs()
    expect(prs).toHaveLength(sampleTUIPRs.length)
    expect(prs[0].number).toBe(10)
  })

  test("returns empty array on empty list", async () => {
    mockSpawn(() => ({ stdout: "[]" }))
    expect(await fetchPRs()).toEqual([])
  })

  test("rejects on gh failure", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "auth required" }))
    await expect(fetchPRs()).rejects.toThrow("auth required")
  })

  test("rejects on bad JSON", async () => {
    mockSpawn(() => ({ stdout: "not json{" }))
    await expect(fetchPRs()).rejects.toThrow()
  })

  test("uses default error message on failure with empty stderr", async () => {
    mockSpawn(() => ({ exitCode: 1 }))
    await expect(fetchPRs()).rejects.toThrow("gh pr list exited 1")
  })

  test("invokes gh pr list with correct args", async () => {
    let captured: string[] = []
    mockSpawnSequence([(args) => {
      captured = args
      return { stdout: "[]" }
    }])
    await fetchPRs()
    expect(captured).toContain("pr")
    expect(captured).toContain("list")
    expect(captured).toContain("--state")
    expect(captured).toContain("open")
    expect(captured).toContain("--json")
    expect(captured).toContain("--limit")
    expect(captured).toContain("50")
  })
})

describe("currentBranchPR", () => {
  test("returns parsed PR on success", async () => {
    const pr = makeTUIPR({ number: 99 })
    mockSpawn(() => ({ stdout: JSON.stringify(pr) }))
    expect(await currentBranchPR()).toEqual(pr)
  })

  test("returns null on gh failure (no PR for branch)", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "no pull requests found" }))
    expect(await currentBranchPR()).toBeNull()
  })

  test("returns null on bad JSON", async () => {
    mockSpawn(() => ({ stdout: "garbage" }))
    expect(await currentBranchPR()).toBeNull()
  })

  test("returns null when JSON has no number", async () => {
    mockSpawn(() => ({ stdout: JSON.stringify({ title: "x" }) }))
    expect(await currentBranchPR()).toBeNull()
  })
})

describe("fetchBranchRequiredReviews", () => {
  test("returns required_approving_reviewers_count when present", async () => {
    mockSpawn(() => ({ stdout: JSON.stringify({ required_approving_reviewers_count: 2 }) }))
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBe(2)
  })

  test("returns null on gh failure", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "no protection" }))
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBeNull()
  })

  test("returns null when field is missing", async () => {
    mockSpawn(() => ({ stdout: JSON.stringify({}) }))
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBeNull()
  })

  test("returns null when field is non-numeric", async () => {
    mockSpawn(() => ({ stdout: JSON.stringify({ required_approving_reviewers_count: "two" }) }))
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBeNull()
  })

  test("returns null on bad JSON", async () => {
    mockSpawn(() => ({ stdout: "not json" }))
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBeNull()
  })
})

describe("fetchOrgMembers", () => {
  test("splits output by newlines and trims", async () => {
    mockSpawn(() => ({ stdout: "alice\nbob\ncarol\n" }))
    const members = await fetchOrgMembers("acme")
    expect(members).toEqual(["alice", "bob", "carol"])
  })

  test("filters empty lines", async () => {
    mockSpawn(() => ({ stdout: "alice\n\nbob\n\n" }))
    const members = await fetchOrgMembers("acme")
    expect(members).toEqual(["alice", "bob"])
  })

  test("returns empty array on failure", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "forbidden" }))
    expect(await fetchOrgMembers("acme")).toEqual([])
  })

  test("returns empty array on empty output", async () => {
    mockSpawn(() => ({ stdout: "" }))
    expect(await fetchOrgMembers("acme")).toEqual([])
  })
})

describe("fetchCurrentUser", () => {
  test("returns trimmed login on success", async () => {
    mockSpawn(() => ({ stdout: "alice\n" }))
    expect(await fetchCurrentUser()).toBe("alice")
  })

  test("returns null on failure", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "not authed" }))
    expect(await fetchCurrentUser()).toBeNull()
  })

  test("returns null on empty output", async () => {
    mockSpawn(() => ({ stdout: "" }))
    expect(await fetchCurrentUser()).toBeNull()
  })

  test("returns null on whitespace-only output", async () => {
    mockSpawn(() => ({ stdout: "   \n" }))
    expect(await fetchCurrentUser()).toBeNull()
  })
})

describe("fetchReviewerThreadCounts", () => {
  test("returns map keyed by PR number with reviewer counts", async () => {
    const data = {
      data: {
        repository: {
          pullRequests: {
            nodes: [
              {
                number: 1,
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: false,
                      comments: {
                        nodes: [
                          { author: { login: "alice" } },
                          { author: { login: "bob" } },
                        ],
                      },
                    },
                    {
                      isResolved: true,
                      comments: {
                        nodes: [
                          { author: { login: "alice" } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const result = await fetchReviewerThreadCounts("foo", "bar")
    const pr1 = result.get(1)
    expect(pr1).toBeDefined()
    expect(pr1!.get("alice")).toEqual({ unresolved: 1, resolved: 1 })
    expect(pr1!.get("bob")).toEqual({ unresolved: 1, resolved: 0 })
  })

  test("returns empty map on gh failure", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "api error" }))
    expect((await fetchReviewerThreadCounts("foo", "bar")).size).toBe(0)
  })

  test("returns empty map on bad JSON", async () => {
    mockSpawn(() => ({ stdout: "garbage" }))
    expect((await fetchReviewerThreadCounts("foo", "bar")).size).toBe(0)
  })

  test("strips [bot] suffix from author logins", async () => {
    const data = {
      data: {
        repository: {
          pullRequests: {
            nodes: [
              {
                number: 1,
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: false,
                      comments: {
                        nodes: [{ author: { login: "dependabot[bot]" } }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const result = await fetchReviewerThreadCounts("foo", "bar")
    const pr1 = result.get(1)!
    expect(pr1.has("dependabot[bot]")).toBe(false)
    expect(pr1.has("dependabot")).toBe(true)
  })

  test("ignores threads with no comment authors", async () => {
    const data = {
      data: {
        repository: {
          pullRequests: {
            nodes: [
              {
                number: 1,
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: false,
                      comments: { nodes: [] },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const result = await fetchReviewerThreadCounts("foo", "bar")
    expect(result.get(1)!.size).toBe(0)
  })
})

describe("fetchReviewerThreads", () => {
  test("returns markdown table with matching reviewer comments", async () => {
    const data = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        author: { login: "alice" },
                        body: "Looks good but check this",
                        createdAt: "2024-01-15T10:00:00Z",
                        path: "src/foo.ts",
                        line: 42,
                      },
                    ],
                  },
                },
                {
                  isResolved: true,
                  comments: {
                    nodes: [
                      {
                        author: { login: "alice" },
                        body: "REJECTED-BODY-MARKER",
                        createdAt: "2024-01-15T11:00:00Z",
                        path: "src/bar.ts",
                        line: 10,
                      },
                    ],
                  },
                },
                {
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        author: { login: "bob" },
                        body: "OUTDATED-FROM-BOB",
                        createdAt: "2024-01-15T12:00:00Z",
                        path: "src/baz.ts",
                        line: 5,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("src/foo.ts")
    expect(out).toContain("42")
    expect(out).toContain("Looks good but check this")
    expect(out).toContain("2024-01-15")
    expect(out).not.toContain("REJECTED-BODY-MARKER")
    expect(out).not.toContain("OUTDATED-FROM-BOB")
  })

  test("strips [bot] suffix from reviewer login when matching", async () => {
    const data = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        author: { login: "dependabot[bot]" },
                        body: "outdated",
                        createdAt: "2024-01-15T10:00:00Z",
                        path: "package.json",
                        line: null,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const out = await fetchReviewerThreads("foo", "bar", 1, "dependabot")
    expect(out).toContain("outdated")
    expect(out).toContain("package.json")
  })

  test("returns failure message on gh error", async () => {
    mockSpawn(() => ({ exitCode: 1, stderr: "graphql error" }))
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("Failed to fetch threads")
    expect(out).toContain("graphql error")
  })

  test("returns no-comments message when reviewer has no unresolved threads", async () => {
    const data = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  comments: {
                    nodes: [{ author: { login: "bob" }, body: "x", createdAt: "x", path: "x", line: 1 }],
                  },
                },
              ],
            },
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("No unresolved comments from @alice on #1")
  })

  test("returns parse-failure message on bad JSON", async () => {
    mockSpawn(() => ({ stdout: "not json" }))
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("Failed to parse response")
  })

  test("truncates long comment bodies to 200 chars", async () => {
    const marker = "@@@@@"
    const longBody = marker.repeat(60) // 300 chars
    const data = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        author: { login: "alice" },
                        body: longBody,
                        createdAt: "2024-01-15T10:00:00Z",
                        path: "src/foo.ts",
                        line: 1,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    // Count @ runs in the body column. The body column starts with 200 chars
    // of @ (5 groups of 40, since 200/5=40). After 40 groups we'd have 200,
    // but we only allow 200 chars, so we should see exactly 40 @s (each @@ = 1 run
    // of @@@@ is split by slice(0,200) so we get 200/5=40 groups).
    const bodyMatch = out.match(/\| ([@]+)/)
    expect(bodyMatch).not.toBeNull()
    if (bodyMatch) {
      expect(bodyMatch[1].length).toBe(200)
    }
  })

  test("replaces newlines in body with spaces", async () => {
    const data = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        author: { login: "alice" },
                        body: "line1\nline2\nline3",
                        createdAt: "2024-01-15T10:00:00Z",
                        path: "x.ts",
                        line: 1,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    }
    mockSpawn(() => ({ stdout: JSON.stringify(data) }))
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("line1 line2 line3")
  })
})
