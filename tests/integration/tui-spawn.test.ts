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
import {
  clearSpawnMocks,
  installSpawnMock,
  mockSpawn,
} from "../helpers/spawn-mock"
import { makeTUIPR, sampleTUIPRs } from "../helpers/tui-fixtures"

installOctokitMock()
installSpawnMock()

const tui = await import("../../plugins/pr-dashboard.tui")
const {
  currentBranchPR,
  detectRepo,
  fetchBranchRequiredReviews,
  fetchOrgMembers,
  fetchPRs,
  fetchReviewerThreadCounts,
  fetchReviewerThreads,
  parseGitHubRemote,
  runGh,
  setCurrentUser,
  setOctokit,
} = tui

beforeEach(() => {
  clearOctokitMocks()
  clearSpawnMocks()
})

afterEach(() => {
  clearOctokitMocks()
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
    expect(res.error).toBe("gh exited 127")
  })

  test("trims trailing whitespace from output", async () => {
    mockSpawn(() => ({ stdout: "  trimmed  \n\n" }))
    const res = await runGh(["gh", "x"])
    expect(res.output).toBe("trimmed")
  })

  test("times out and returns error when proc hangs", async () => {
    // Spawn a process that just sleeps. Mock it by returning a never-resolving proc.
    // We simulate this via a custom handler that returns exitCode via a never-resolving Promise.
    // Simpler: mock spawn with a handler that doesn't trigger exited.
    // Since the mock is auto-resolving with exitCode 0, we instead test by passing a tiny timeout.
    // We use a real process: `sleep 5` is not portable. Instead, call runGh with timeoutMs: 1 against
    // a mock whose exited promise resolves after a setTimeout longer than 1ms.
    const { mock } = await import("bun:test")
    const { spawn } = await import("../../plugins/bun-utils")
    const realSpawn = (await import("../../plugins/bun-utils")).spawn
    // Patch: make the spawned proc never exit by replacing the mock to throw instead.
    // Easier: have the mock return a proc that never calls resolve; runGh's timer kills it via proc.kill.
    // The mock returns an object that looks like a proc; we monkey-patch the global mock to return one without an exited promise that resolves soon.
    // For simplicity here, we verify the timeout flag via a fake spawn that hangs:
    const hungExited = new Promise<number>(() => {}) // never resolves
    const fakeProc: any = {
      stdout: { pipeTo: () => {} },
      stderr: { pipeTo: () => {} },
      exited: hungExited,
      kill: () => {},
    }
    mockSpawn(() => {
      // Return a fake proc shape with no auto-resolution path
      // (mockSpawn wraps the result; we need to override the makeMockProc).
      // Workaround: use installSpawnMock's mock.module to patch spawn directly.
      void fakeProc
      return { stdout: "" }
    })
    // Patch spawn globally for this test only:
    const repoRoot = `${import.meta.dir}/../..`
    mock.module(`${repoRoot}/plugins/bun-utils.ts`, () => ({
      spawn: () => fakeProc,
    }))
    // Re-import the runGh binding so it picks up the patched spawn.
    const { runGh: runGhPatched } = await import(`../../plugins/infra/gh?timeout=${Date.now()}`)
    const res = await runGhPatched(["gh", "slow"], { timeoutMs: 50 })
    expect(res.ok).toBe(false)
    expect(res.timedOut).toBe(true)
    expect(res.error).toContain("timed out")
  })
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

describe("fetchPRs", () => {
  test("maps Octokit PR data to TuiPR", async () => {
    const octokitPR = {
      number: 10,
      title: "Test PR",
      html_url: "https://github.com/foo/bar/pull/10",
      draft: false,
      user: { login: "alice" },
      head: { ref: "feature" },
      base: { ref: "main" },
      review_decision: "APPROVED",
      mergeable: true,
      mergeable_state: "clean",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
      status_check_rollup: [{ name: "ci", conclusion: "SUCCESS", status: "completed" }],
      requested_reviewers: [{ login: "bob" }],
      latest_reviews: [{ user: { login: "bob" }, state: "APPROVED", submitted_at: "2024-01-02" }],
      assignees: [],
    }
    mockOctokitDefault(() => ({ data: [octokitPR] }))
    const prs = await fetchPRs("all", { owner: "foo", repo: "bar" })
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({
      number: 10,
      title: "Test PR",
      author: { login: "alice" },
      headRefName: "feature",
      baseRefName: "main",
      reviewDecision: "APPROVED",
      mergeStateStatus: "clean",
    })
  })

  test("returns empty array when octokit returns no data", async () => {
    mockOctokitDefault(() => ({ data: [] }))
    const prs = await fetchPRs("all", { owner: "foo", repo: "bar" })
    expect(prs).toEqual([])
  })

  test("returns empty array when repo is null", async () => {
    const prs = await fetchPRs("all", null)
    expect(prs).toEqual([])
  })

  test("filter=author keeps only PRs by current user", async () => {
    setCurrentUser("alice")
    mockOctokitDefault(() => ({
      data: [
        makeOctokitPR({ number: 1, user: "alice" }),
        makeOctokitPR({ number: 2, user: "bob" }),
      ],
    }))
    const prs = await fetchPRs("author", { owner: "foo", repo: "bar" })
    expect(prs.map((p) => p.number)).toEqual([1])
  })

  test("filter=assigned keeps only PRs where current user is assignee", async () => {
    setCurrentUser("bob")
    mockOctokitDefault(() => ({
      data: [
        makeOctokitPR({ number: 1, user: "alice", assignees: [] }),
        makeOctokitPR({ number: 2, user: "alice", assignees: ["bob"] }),
      ],
    }))
    const prs = await fetchPRs("assigned", { owner: "foo", repo: "bar" })
    expect(prs.map((p) => p.number)).toEqual([2])
  })

  test("filter=all returns all PRs regardless of author/assignee", async () => {
    setCurrentUser("alice")
    mockOctokitDefault(() => ({
      data: [
        makeOctokitPR({ number: 1, user: "alice" }),
        makeOctokitPR({ number: 2, user: "bob" }),
      ],
    }))
    const prs = await fetchPRs("all", { owner: "foo", repo: "bar" })
    expect(prs).toHaveLength(2)
  })
})

describe("currentBranchPR", () => {
  function makeRepoDir(branch: string): string {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`)
    return dir
  }

  test("returns the PR matching current branch + current user", async () => {
    const dir = makeRepoDir("feature")
    setCurrentUser("alice")
    mockOctokitDefault(() => ({ data: [makeOctokitPR({ number: 7, user: "alice" })] }))
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir)
    expect(pr?.number).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when no PR for branch", async () => {
    const dir = makeRepoDir("feature")
    setCurrentUser("alice")
    mockOctokitDefault(() => ({ data: [] }))
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

describe("fetchBranchRequiredReviews", () => {
  test("returns required_approving_review_count when present", async () => {
    mockOctokitDefault(() => ({
      data: { required_pull_request_reviews: { required_approving_review_count: 2 } },
    }))
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBe(2)
  })

  test("returns null on error", async () => {
    mockOctokitDefault(() => {
      throw new Error("no protection")
    })
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBeNull()
  })

  test("returns null when required_pull_request_reviews is missing", async () => {
    mockOctokitDefault(() => ({ data: {} }))
    expect(await fetchBranchRequiredReviews("foo", "bar", "main")).toBeNull()
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

describe("fetchReviewerThreadCounts", () => {
  test("returns map keyed by PR number with reviewer counts", async () => {
    const data = {
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 1,
              reviewThreads: {
                nodes: [
                  {
                    isResolved: false,
                    comments: { nodes: [{ author: { login: "alice" } }, { author: { login: "bob" } }] },
                  },
                  {
                    isResolved: true,
                    comments: { nodes: [{ author: { login: "alice" } }] },
                  },
                ],
              },
            },
          ],
        },
      },
    }
    mockOctokitDefault(() => data)
    const result = await fetchReviewerThreadCounts("foo", "bar")
    const pr1 = result.get(1)
    expect(pr1).toBeDefined()
    expect(pr1!.get("alice")).toEqual({ unresolved: 1, resolved: 1 })
    expect(pr1!.get("bob")).toEqual({ unresolved: 1, resolved: 0 })
  })

  test("returns empty map on graphql error", async () => {
    mockOctokitDefault(() => {
      throw new Error("api error")
    })
    expect((await fetchReviewerThreadCounts("foo", "bar")).size).toBe(0)
  })

  test("strips [bot] suffix from author logins", async () => {
    const data = {
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 1,
              reviewThreads: {
                nodes: [
                  {
                    isResolved: false,
                    comments: { nodes: [{ author: { login: "dependabot[bot]" } }] },
                  },
                ],
              },
            },
          ],
        },
      },
    }
    mockOctokitDefault(() => data)
    const result = await fetchReviewerThreadCounts("foo", "bar")
    const pr1 = result.get(1)!
    expect(pr1.has("dependabot[bot]")).toBe(false)
    expect(pr1.has("dependabot")).toBe(true)
  })
})

describe("fetchReviewerThreads", () => {
  test("returns markdown table with matching reviewer comments", async () => {
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
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("src/foo.ts")
    expect(out).toContain("42")
    expect(out).toContain("Looks good but check this")
    expect(out).toContain("2024-01-15")
    expect(out).not.toContain("REJECTED-BODY-MARKER")
    expect(out).not.toContain("OUTDATED-FROM-BOB")
  })

  test("returns failure message on error", async () => {
    mockOctokitDefault(() => {
      throw new Error("graphql error")
    })
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("Failed to fetch threads")
    expect(out).toContain("graphql error")
  })

  test("returns no-comments message when reviewer has no unresolved threads", async () => {
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
    const out = await fetchReviewerThreads("foo", "bar", 1, "alice")
    expect(out).toContain("No unresolved comments from @alice on #1")
  })
})

function makeOctokitPR(opts: {
  number: number
  user: string
  assignees?: string[]
  baseRef?: string
}): any {
  return {
    number: opts.number,
    title: `PR ${opts.number}`,
    html_url: `https://github.com/foo/bar/pull/${opts.number}`,
    draft: false,
    user: { login: opts.user },
    head: { ref: "feature" },
    base: { ref: opts.baseRef ?? "main" },
    review_decision: null,
    mergeable: true,
    mergeable_state: "clean",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    status_check_rollup: null,
    requested_reviewers: [],
    latest_reviews: [],
    assignees: (opts.assignees ?? []).map((login) => ({ login })),
  }
}
