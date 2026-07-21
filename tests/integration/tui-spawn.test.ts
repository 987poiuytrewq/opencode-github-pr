import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
  mockOctokitOp,
} from "../helpers/octokit-mock"
import { setOctokit } from "../../plugins/infra/octokit"
import { parseGitHubRemote, detectRepo } from "../../plugins/infra/git"
import {
  currentBranchPR,
  fetchDashboardData,
  fetchOrgMembers,
  fetchOnePR,
  fetchReviewerThreads,
} from "../../plugins/infra/loader"

import { PRFilter } from "../../plugins/domain/types"

installOctokitMock()

beforeEach(() => {
  clearOctokitMocks()
})

afterEach(() => {
  clearOctokitMocks()
})

describe("parseGitHubRemote", () => {
  test("parses HTTPS url", () => {
    expect(parseGitHubRemote("https://github.com/foo/bar.git")).toEqual({
      owner: "foo",
      repo: "bar",
    })
  })

  test("parses SSH url", () => {
    const ssh = "git" + "@" + "github.com:foo/bar.git"
    expect(parseGitHubRemote(ssh)).toEqual({ owner: "foo", repo: "bar" })
  })

  test("strips .git suffix", () => {
    expect(parseGitHubRemote("https://github.com/foo/bar.git")).toEqual({
      owner: "foo",
      repo: "bar",
    })
  })

  test("returns null for non-github urls", () => {
    expect(parseGitHubRemote("https://gitlab.com/foo/bar")).toBeNull()
  })

  test("returns null for malformed input", () => {
    expect(parseGitHubRemote("not-a-url")).toBeNull()
  })
})

describe("detectRepo", () => {
  function makeRepoDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(
      join(dir, ".git", "config"),
      `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = https://github.com/foo/bar.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`,
    )
    return dir
  }

  test("reads .git/config and returns owner/repo", () => {
    const dir = makeRepoDir()
    expect(detectRepo(dir)).toEqual({ owner: "foo", repo: "bar" })
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when no .git/config exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    expect(detectRepo(dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when no [remote origin] section", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(join(dir, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n")
    expect(detectRepo(dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("currentBranchPR", () => {
  function makeRepoDir(branch: string): string {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`)
    return dir
  }

  test("returns the PR matching current branch", async () => {
    const dir = makeRepoDir("feature")
    let lastQuery = ""
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        lastQuery = params?.params?.q ?? ""
        return { search: { nodes: [makeSearchPR({ number: 7 })] } }
      }
      return null
    })
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir)
    expect(lastQuery).toContain("head:feature")
    expect(pr?.number).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when no PR for branch", async () => {
    const dir = makeRepoDir("feature")
    mockOctokitDefault((op) => {
      if (op === "graphql") return { search: { nodes: [] } }
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
    const dir = makeRepoDir("feature")
    const pr = await currentBranchPR(null, dir)
    expect(pr).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("fetchDashboardData", () => {
  function makeDashboardPR(opts: {
    number: number
    baseRef?: string
    threads?: any[]
  }): any {
    return {
      number: opts.number,
      title: `PR ${opts.number}`,
      url: `https://github.com/foo/bar/pull/${opts.number}`,
      isDraft: false,
      author: { login: "alice" },
      headRefName: "feature",
      baseRefName: opts.baseRef ?? "main",
      reviewDecision: null,
      mergeable: "MERGEABLE",
      mergeStateStatus: "clean",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      reviewRequests: { nodes: [] },
      latestReviews: { nodes: [] },
      assignees: { nodes: [] },
      reviewThreads: { nodes: opts.threads ?? [] },
    }
  }

  test("returns prs, threadCounts, and branchRules from combined query", async () => {
    const searchPR = makeDashboardPR({
      number: 10,
      baseRef: "main",
      threads: [
        {
          isResolved: false,
          comments: { nodes: [{ author: { login: "alice" } }, { author: { login: "bob" } }] },
        },
        {
          isResolved: true,
          comments: { nodes: [{ author: { login: "alice" } }] },
        },
      ],
    })
    let lastQuery = ""
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        if (params.query.includes("search(")) {
          lastQuery = params.params.q ?? ""
          return { search: { nodes: [searchPR] } }
        }
        if (params.query.includes("branchProtectionRules")) {
          return {
            repository: {
              branchProtectionRules: {
                nodes: [{ pattern: "main", requiredApprovingReviews: 2 }],
              },
            },
          }
        }
      }
      return null
    })
    const result = await fetchDashboardData(PRFilter.Author, { owner: "foo", repo: "bar" })
    expect(lastQuery).toContain("author:@me")
    expect(lastQuery).toContain("repo:foo/bar")
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].number).toBe(10)
    const tc = result.threadCounts.get(10)
    expect(tc).toBeDefined()
    expect(tc!.get("alice")).toEqual({ unresolved: 1, resolved: 1 })
    expect(tc!.get("bob")).toEqual({ unresolved: 1, resolved: 0 })
    expect(result.branchRules.get("main")).toBe(2)
  })

  test("resolves branch rules with wildcard patterns", async () => {
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        if (params.query.includes("search(")) {
          return {
            search: {
              nodes: [
                makeDashboardPR({ number: 1, baseRef: "release/v1" }),
                makeDashboardPR({ number: 2, baseRef: "main" }),
              ],
            },
          }
        }
        if (params.query.includes("branchProtectionRules")) {
          return {
            repository: {
              branchProtectionRules: {
                nodes: [
                  { pattern: "main", requiredApprovingReviews: 1 },
                  { pattern: "release/*", requiredApprovingReviews: 2 },
                ],
              },
            },
          }
        }
      }
      return null
    })
    const result = await fetchDashboardData(PRFilter.Author, { owner: "foo", repo: "bar" })
    expect(result.branchRules.get("main")).toBe(1)
    expect(result.branchRules.get("release/v1")).toBe(2)
  })

  test("returns null branch rules when no matching pattern", async () => {
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        if (params.query.includes("search(")) {
          return { search: { nodes: [makeDashboardPR({ number: 1, baseRef: "dev" })] } }
        }
        if (params.query.includes("branchProtectionRules")) {
          return {
            repository: {
              branchProtectionRules: {
                nodes: [{ pattern: "main", requiredApprovingReviews: 2 }],
              },
            },
          }
        }
      }
      return null
    })
    const result = await fetchDashboardData(PRFilter.Author, { owner: "foo", repo: "bar" })
    expect(result.branchRules.get("dev")).toBeNull()
  })

  test("returns empty branch rules on graphql error (graceful)", async () => {
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        if (params.query.includes("search(")) {
          return { search: { nodes: [makeDashboardPR({ number: 1 })] } }
        }
        throw new Error("no admin access")
      }
      return null
    })
    const result = await fetchDashboardData(PRFilter.Author, { owner: "foo", repo: "bar" })
    expect(result.prs).toHaveLength(1)
    expect(result.branchRules.size).toBe(1)
    expect(result.branchRules.get("main")).toBeNull()
  })

  test("returns empty everything when repo is null", async () => {
    const result = await fetchDashboardData(PRFilter.Author, null)
    expect(result.prs).toEqual([])
    expect(result.threadCounts.size).toBe(0)
    expect(result.branchRules.size).toBe(0)
  })

  test("strips [bot] suffix from thread comment authors", async () => {
    const searchPR = makeDashboardPR({
      number: 1,
      threads: [
        {
          isResolved: false,
          comments: { nodes: [{ author: { login: "dependabot[bot]" } }] },
        },
      ],
    })
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        if (params.query.includes("search(")) return { search: { nodes: [searchPR] } }
        return { repository: { branchProtectionRules: { nodes: [] } } }
      }
      return null
    })
    const result = await fetchDashboardData(PRFilter.Author, { owner: "foo", repo: "bar" })
    const tc = result.threadCounts.get(1)!
    expect(tc.has("dependabot[bot]")).toBe(false)
    expect(tc.has("dependabot")).toBe(true)
  })

  test("returns partial data when GraphQL errors include accessible data", async () => {
    const searchPR = makeDashboardPR({ number: 1, baseRef: "main" })
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        if (params.query.includes("search(")) {
          const err = new Error(
            "Resource not accessible by personal access token",
          ) as any
          err.data = { search: { nodes: [searchPR] } }
          err.errors = [
            { type: "FORBIDDEN", message: "Resource not accessible by personal access token" },
          ]
          throw err
        }
        return { repository: { branchProtectionRules: { nodes: [] } } }
      }
      return null
    })
    const result = await fetchDashboardData(PRFilter.Author, { owner: "foo", repo: "bar" })
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].number).toBe(1)
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

function makeSearchPR(opts: {
  number: number
  user?: string
  assignees?: string[]
  baseRef?: string
}): any {
  return {
    number: opts.number,
    title: `PR ${opts.number}`,
    url: `https://github.com/foo/bar/pull/${opts.number}`,
    isDraft: false,
    author: { login: opts.user ?? "alice" },
    headRefName: "feature",
    baseRefName: opts.baseRef ?? "main",
    reviewDecision: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "clean",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    statusCheckRollup: null,
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    assignees: { nodes: (opts.assignees ?? []).map((login) => ({ login })) },
  }
}

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
    expect(pr.author).toEqual({ login: "alice" })
    expect(pr.headRefName).toBe("feature")
    expect(pr.baseRefName).toBe("main")
    expect(pr.mergeable).toBe("MERGEABLE")
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
