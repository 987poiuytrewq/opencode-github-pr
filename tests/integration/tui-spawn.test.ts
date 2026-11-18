import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
  mockOctokitOp,
} from "../helpers/octokit-mock"
import {
  currentBranchPR,
  currentBranchPRs,
  fetchOrgMembers,
  fetchOnePR,
  fetchReviewerThreads,
} from "../../plugins/infra/loader"
import { makeFakeRepo } from "../helpers/graphql-mock"

installOctokitMock()

beforeEach(() => {
  clearOctokitMocks()
})

afterEach(() => {
  clearOctokitMocks()
})

describe("currentBranchPR", () => {
  test("returns the PR matching current branch", async () => {
    const dir = makeFakeRepo("foo", "bar")
    let lastQuery = ""
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        lastQuery = params?.query ?? ""
        return {
          repository: {
            pullRequests: { nodes: [{
              number: 7,
              title: "PR 7",
              url: "https://github.com/foo/bar/pull/7",
              isDraft: false,
              state: "OPEN",
              additions: 12,
              deletions: 3,
              baseRefName: "main",
              mergeable: "MERGEABLE",
              statusCheckRollup: { state: "SUCCESS" },
              reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] },
              reviewRequests: { nodes: [] },
              latestReviews: { nodes: [] },
            }] },
          },
        }
      }
      return null
    })
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir)
    expect(lastQuery).toContain("headRefName: $head")
    expect(lastQuery).toContain("states: [OPEN, MERGED]")
    expect(lastQuery).toContain("additions")
    expect(lastQuery).toContain("deletions")
    expect(lastQuery).toContain("reviewThreads(first: 100)")
    expect(pr?.number).toBe(7)
    expect(pr?.reviewThreads).toEqual([{ isResolved: false }, { isResolved: true }])
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when no PR for branch", async () => {
    const dir = makeFakeRepo("foo", "bar")
    mockOctokitDefault((op) => {
      if (op === "graphql") return { repository: { pullRequests: { nodes: [] } } }
      return null
    })
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir)
    expect(pr).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when no .git/HEAD exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir)
    expect(pr).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when repo is null", async () => {
    const dir = makeFakeRepo("foo", "bar")
    const pr = await currentBranchPR(null, dir)
    expect(pr).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns open and merged PRs for the current branch", async () => {
    const dir = makeFakeRepo("foo", "bar")
    let lastParams: any
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        lastParams = params?.params
        return {
          repository: {
            pullRequests: { nodes: [
              { number: 8, title: "Open", state: "OPEN", additions: 4, deletions: 1 },
              { number: 7, title: "Merged", state: "MERGED", additions: 10, deletions: 2 },
            ] },
          },
        }
      }
      return null
    })
    const prs = await currentBranchPRs({ owner: "foo", repo: "bar" }, dir)
    expect(lastParams).toEqual({ owner: "foo", name: "bar", head: "main" })
    expect(prs.map((pr) => [pr.number, pr.isMerged, pr.additions, pr.deletions])).toEqual([
      [8, false, 4, 1],
      [7, true, 10, 2],
    ])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("fetchOrgMembers", () => {
  test("extracts logins from listMembers response", async () => {
    mockOctokitDefault(() => ({ data: [{ login: "alice" }, { login: "bob" }] }))
    const members = await fetchOrgMembers("acme")
    expect(members).toEqual(["alice", "bob"])
  })

  test("returns empty array on error", async () => {
    mockOctokitDefault(() => {
      throw new Error("forbidden")
    })
    expect(await fetchOrgMembers("acme")).toEqual([])
  })
})

describe("fetchReviewerThreads", () => {
  test("returns data array with matching reviewer threads (excludes resolved and other reviewers)", async () => {
    const data = {
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
    }
    mockOctokitDefault(() => data)
    const threads = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(threads).toHaveLength(1)
    expect(threads[0].path).toBe("src/foo.ts")
    expect(threads[0].line).toBe(42)
    expect(threads[0].body).toContain("Looks good but check this")
    expect(threads[0].createdAt).toBe("2024-01-15T10:00:00Z")
    expect(threads[0].author).toBe("alice")
    expect(threads.some((t) => t.body.includes("REJECTED-BODY-MARKER"))).toBe(false)
    expect(threads.some((t) => t.body.includes("OUTDATED-FROM-BOB"))).toBe(false)
  })

  test("throws on graphql error", async () => {
    mockOctokitDefault(() => {
      throw new Error("graphql error")
    })
    await expect(fetchReviewerThreads("foo", "bar", 1, "alice")).rejects.toThrow(
      "Failed to fetch threads: graphql error",
    )
  })

  test("returns empty array when reviewer has no unresolved threads", async () => {
    const data = {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                isResolved: false,
                comments: { nodes: [{ author: { login: "bob" }, body: "x", createdAt: "x", path: "x", line: 1 }] },
              },
            ],
          },
        },
      },
    }
    mockOctokitDefault(() => data)
    const threads = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(threads).toEqual([])
  })
})


describe("fetchOnePR", () => {
  test("maps REST pulls.get response to PR", async () => {
    const restPR = {
      number: 42,
      title: "REST PR",
      html_url: "https://github.com/foo/bar/pull/42",
      draft: false,
      user: { login: "alice" },
      head: { ref: "feature" },
      base: { ref: "main" },
      review_decision: "APPROVED",
      mergeable: true,
      merged: false,
      additions: 9,
      deletions: 2,
      mergeable_state: "clean",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
      status_check_rollup: null,
      requested_reviewers: [{ login: "bob" }],
      latest_reviews: [],
      assignees: [],
    }
    let captured: any = null
    mockOctokitOp("pulls.get", (params) => {
      captured = params
      return { data: restPR }
    })
    const pr = await fetchOnePR({ owner: "foo", repo: "bar" }, 42)
    expect(captured).toMatchObject({ owner: "foo", repo: "bar", pull_number: 42 })
    expect(pr.number).toBe(42)
    expect(pr.title).toBe("REST PR")
    expect(pr.url).toBe("https://github.com/foo/bar/pull/42")
    expect(pr.baseRefName).toBe("main")
    expect(pr.mergeable).toBe("MERGEABLE")
    expect(pr.isMerged).toBe(false)
    expect(pr.additions).toBe(9)
    expect(pr.deletions).toBe(2)
    expect(pr.reviewThreads).toBeNull()
    expect(pr.reviewRequests).toEqual([{ login: "bob" }])
  })

  test("maps mergeable=false to CONFLICTING", async () => {
    mockOctokitOp("pulls.get", () => ({
      data: {
        number: 1,
        title: "x",
        html_url: "u",
        draft: false,
        user: { login: "a" },
        head: { ref: "f" },
        base: { ref: "m" },
        mergeable: false,
        mergeable_state: "dirty",
        created_at: "x",
        updated_at: "x",
      },
    }))
    const pr = await fetchOnePR({ owner: "foo", repo: "bar" }, 1)
    expect(pr.mergeable).toBe("CONFLICTING")
  })
})
