import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { currentBranch, parseGitHubRemote, detectRepo } from "../../plugins/infra/git"
import { makeFakeRepo } from "../helpers/graphql-mock"

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
  test("reads .git/config and returns owner/repo", () => {
    const dir = makeFakeRepo("foo", "bar")
    expect(detectRepo(dir)).toEqual({ owner: "foo", repo: "bar" })
    rmSync(dir, { recursive: true, force: true })
  })

  test("reads shared config and HEAD from a linked worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "pr-dash-worktree-"))
    const worktree = join(root, "checkout")
    const commonGitDir = join(root, "repo.git")
    const worktreeGitDir = join(commonGitDir, "worktrees", "checkout")
    mkdirSync(worktree, { recursive: true })
    mkdirSync(worktreeGitDir, { recursive: true })
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`)
    writeFileSync(join(worktreeGitDir, "commondir"), "../..\n")
    writeFileSync(
      join(commonGitDir, "config"),
      `[remote "origin"]\n\turl = git@github.com:foo/bar.git\n`,
    )
    writeFileSync(join(worktreeGitDir, "HEAD"), "ref: refs/heads/e2e-plugin-install\n")

    expect(detectRepo(worktree)).toEqual({ owner: "foo", repo: "bar" })
    expect(currentBranch(worktree)).toBe("e2e-plugin-install")
    rmSync(root, { recursive: true, force: true })
  })

  test("returns null when no .git/config exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    expect(detectRepo(dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null when no [remote origin] section", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    rmSync(dir, { recursive: true, force: true })
    expect(detectRepo(dir)).toBeNull()
  })
})
