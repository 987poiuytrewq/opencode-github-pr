import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrDashboardPlugin } from "../../plugins/pr-dashboard"
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitOp,
} from "../helpers/octokit-mock"

installOctokitMock()

function makeRepoDir(owner = "foo", repo = "bar"): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-dash-server-"))
  mkdirSync(join(dir, ".git"))
  writeFileSync(
    join(dir, ".git", "config"),
    `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = https://github.com/${owner}/${repo}.git
\tfetch = +refs/heads/*:refs/remotes/origote/*
`,
  )
  return dir
}

function buildApi(directory: string) {
  return {
    directory,
    client: {} as any,
    project: {} as any,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:0"),
  } as any
}

beforeEach(() => {
  clearOctokitMocks()
})

describe("PrDashboardPlugin", () => {
  test("exports tool definitions for both tools", async () => {
    const hooks = await PrDashboardPlugin(buildApi("/work/foo"))
    expect(hooks.tool).toBeDefined()
    expect(Object.keys(hooks.tool!).sort()).toEqual(
      ["pr_add_reviewer", "pr_rerequest_review"].sort(),
    )
  })

  describe("pr_add_reviewer tool", () => {
    test("calls requestReviewers with the right args", async () => {
      const dir = makeRepoDir()
      let captured: any = null
      mockOctokitOp("pulls.requestReviewers", (params: any) => {
        captured = params
        return { data: {} }
      })
      const hooks = await PrDashboardPlugin(buildApi(dir))
      const out = await hooks.tool!.pr_add_reviewer.execute(
        { pr: 42, reviewer: "alice" } as any,
        { directory: dir } as any,
      )
      expect(captured).toMatchObject({
        owner: "foo",
        repo: "bar",
        pull_number: 42,
        reviewers: ["alice"],
      })
      expect(out).toContain("alice")
      expect(out).toContain("42")
      rmSync(dir, { recursive: true, force: true })
    })

    test("returns error message on failure", async () => {
      const dir = makeRepoDir()
      mockOctokitOp("pulls.requestReviewers", () => {
        const e: any = new Error("permission denied")
        e.status = 403
        throw e
      })
      const hooks = await PrDashboardPlugin(buildApi(dir))
      const out = await hooks.tool!.pr_add_reviewer.execute(
        { pr: 42, reviewer: "alice" } as any,
        { directory: dir } as any,
      )
      expect(out).toContain("Failed:")
      expect(out).toContain("permission denied")
      rmSync(dir, { recursive: true, force: true })
    })
  })

  describe("pr_rerequest_review tool", () => {
    test("calls requestReviewers with the right args", async () => {
      const dir = makeRepoDir()
      let captured: any = null
      mockOctokitOp("pulls.requestReviewers", (params: any) => {
        captured = params
        return { data: {} }
      })
      const hooks = await PrDashboardPlugin(buildApi(dir))
      const out = await hooks.tool!.pr_rerequest_review.execute(
        { pr: 7, reviewer: "bob" } as any,
        { directory: dir } as any,
      )
      expect(captured).toMatchObject({
        owner: "foo",
        repo: "bar",
        pull_number: 7,
        reviewers: ["bob"],
      })
      expect(out).toContain("Re-requested")
      rmSync(dir, { recursive: true, force: true })
    })

    test("returns error message on failure", async () => {
      const dir = makeRepoDir()
      mockOctokitOp("pulls.requestReviewers", () => {
        const e: any = new Error("not allowed")
        e.status = 403
        throw e
      })
      const hooks = await PrDashboardPlugin(buildApi(dir))
      const out = await hooks.tool!.pr_rerequest_review.execute(
        { pr: 7, reviewer: "bob" } as any,
        { directory: dir } as any,
      )
      expect(out).toContain("Failed:")
      expect(out).toContain("not allowed")
      rmSync(dir, { recursive: true, force: true })
    })

    test("falls back to plugin directory when context has none", async () => {
      const dir = makeRepoDir()
      let captured: any = null
      mockOctokitOp("pulls.requestReviewers", (params: any) => {
        captured = params
        return { data: {} }
      })
      const hooks = await PrDashboardPlugin(buildApi(dir))
      await hooks.tool!.pr_add_reviewer.execute(
        { pr: 1, reviewer: "x" } as any,
        {} as any,
      )
      expect(captured.owner).toBe("foo")
      expect(captured.repo).toBe("bar")
      rmSync(dir, { recursive: true, force: true })
    })
  })
})
