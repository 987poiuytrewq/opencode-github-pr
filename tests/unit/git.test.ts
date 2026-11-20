import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  currentBranch,
  parseGitHubRemote,
  detectRepo,
} from "../../plugins/infra/git"
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

  test("parses URI-style SSH urls", () => {
    expect(parseGitHubRemote("ssh://git@github.com/foo/bar.git")).toEqual({
      owner: "foo",
      repo: "bar",
    })
  })

  test("parses GitHub SSH over port 443", () => {
    expect(
      parseGitHubRemote("ssh://git@ssh.github.com:443/foo/bar.git"),
    ).toEqual({ owner: "foo", repo: "bar" })
  })

  test("parses GitHub Enterprise HTTPS and SSH remotes when configured", () => {
    const enterpriseUrl = "https://github.example.test"
    expect(
      parseGitHubRemote(
        "https://github.example.test/acme/widgets.git",
        enterpriseUrl,
      ),
    ).toEqual({
      owner: "acme",
      repo: "widgets",
    })
    expect(
      parseGitHubRemote(
        "ssh://git@github.example.test/acme/widgets.git",
        enterpriseUrl,
      ),
    ).toEqual({
      owner: "acme",
      repo: "widgets",
    })
    expect(
      parseGitHubRemote(
        "git@github.example.test:acme/widgets.git",
        enterpriseUrl,
      ),
    ).toEqual({
      owner: "acme",
      repo: "widgets",
    })
  })

  test("does not mistake a github.com remote for a configured enterprise host", () => {
    expect(
      parseGitHubRemote(
        "https://github.com/acme/widgets.git",
        "https://github.example.test",
      ),
    ).toBeNull()
  })

  test("parses HTTPS URLs with credentials and trailing slash", () => {
    expect(parseGitHubRemote("https://user@github.com/foo/bar.git/")).toEqual({
      owner: "foo",
      repo: "bar",
    })
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
    try {
      expect(detectRepo(dir)).toEqual({ owner: "foo", repo: "bar" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("finds the nearest repository from a nested directory", () => {
    const dir = makeFakeRepo("foo", "bar")
    const nested = join(dir, "src", "deep")
    mkdirSync(nested, { recursive: true })
    try {
      expect(detectRepo(nested)).toEqual({ owner: "foo", repo: "bar" })
      expect(currentBranch(nested)).toBe("main")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("uses the nearest nested repository for current-branch detection", () => {
    const outer = makeFakeRepo("outer", "repo")
    const inner = join(outer, "packages", "inner")
    mkdirSync(join(inner, ".git"), { recursive: true })
    writeFileSync(
      join(inner, ".git", "config"),
      `[remote "origin"]\n\turl = git@github.com:inner/repo.git\n`,
    )
    writeFileSync(join(inner, ".git", "HEAD"), "ref: refs/heads/inner-branch\n")
    const nested = join(inner, "src", "deep")
    mkdirSync(nested, { recursive: true })

    try {
      expect(detectRepo(nested)).toEqual({ owner: "inner", repo: "repo" })
      expect(currentBranch(nested)).toBe("inner-branch")
    } finally {
      rmSync(outer, { recursive: true, force: true })
    }
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
    writeFileSync(join(commonGitDir, "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(
      join(worktreeGitDir, "HEAD"),
      "ref: refs/heads/e2e-plugin-install\n",
    )

    try {
      const nested = join(worktree, "src", "nested")
      mkdirSync(nested, { recursive: true })

      expect(detectRepo(nested)).toEqual({ owner: "foo", repo: "bar" })
      expect(currentBranch(nested)).toBe("e2e-plugin-install")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("returns null for a detached HEAD", () => {
    const dir = makeFakeRepo("foo", "bar")
    try {
      writeFileSync(join(dir, ".git", "HEAD"), `${"a".repeat(40)}\n`)
      expect(currentBranch(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("detects a sibling .bare repository without treating its HEAD as the worktree branch", () => {
    const root = mkdtempSync(join(tmpdir(), "pr-dash-bare-"))
    const bareDir = join(root, ".bare")
    mkdirSync(join(bareDir, "objects"), { recursive: true })
    writeFileSync(
      join(bareDir, "config"),
      `[core]\n\tbare = true\n[remote "origin"]\n\turl = git@github.com:foo/bar.git\n`,
    )
    writeFileSync(join(bareDir, "HEAD"), "ref: refs/heads/main\n")

    expect(detectRepo(root)).toEqual({ owner: "foo", repo: "bar" })
    expect(currentBranch(root)).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })

  test("detects a bare repository when opened directly", () => {
    const root = mkdtempSync(join(tmpdir(), "pr-dash-bare-direct-"))
    mkdirSync(join(root, "objects"))
    writeFileSync(
      join(root, "config"),
      `[core]\n\tbare = true\n[remote "origin"]\n\turl = git@github.com:foo/bar.git\n`,
    )
    writeFileSync(join(root, "HEAD"), "ref: refs/heads/main\n")

    expect(detectRepo(root)).toEqual({ owner: "foo", repo: "bar" })
    expect(currentBranch(root)).toBe("main")
    rmSync(root, { recursive: true, force: true })
  })

  test("returns null when no .git/config exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    try {
      expect(detectRepo(dir)).toBeNull()
      expect(currentBranch(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("finds a GitHub remote when origin is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(
      join(dir, ".git", "config"),
      `[remote "upstream"]\n\turl = ssh://git@github.com/foo/bar.git\n`,
    )
    try {
      expect(detectRepo(dir)).toEqual({ owner: "foo", repo: "bar" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("resolves SSH host aliases to GitHub using ssh configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "pr-dash-ssh-alias-"))
    const home = join(root, "home")
    const checkout = join(root, "checkout")
    mkdirSync(join(home, ".ssh"), { recursive: true })
    mkdirSync(join(checkout, ".git"), { recursive: true })
    writeFileSync(
      join(home, ".ssh", "config"),
      `Host github-work-test\n  HostName github.com\n  User git\n`,
    )
    writeFileSync(
      join(checkout, ".git", "config"),
      `[remote "origin"]\n\turl = git@github-work-test:org/repo.git\n`,
    )
    const previousHome = process.env.HOME
    process.env.HOME = home

    try {
      expect(detectRepo(checkout)).toEqual({ owner: "org", repo: "repo" })
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("applies the longest matching Git insteadOf rewrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-insteadof-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(
      join(dir, ".git", "config"),
      `[remote "origin"]\n\turl = code:org/repo.git\n` +
        `[url "https://github.com/"]\n\tinsteadOf = code:\n` +
        `[url "git@github.com:octocat/"]\n\tinsteadOf = code:org/\n`,
    )
    try {
      expect(detectRepo(dir)).toEqual({ owner: "octocat", repo: "repo" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prefers GitHub origin when multiple GitHub remotes exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(
      join(dir, ".git", "config"),
      `[remote "upstream"]\n\turl = https://github.com/upstream/repo.git\n[remote "origin"]\n\turl = https://github.com/fork/repo.git\n`,
    )
    try {
      expect(detectRepo(dir)).toEqual({ owner: "fork", repo: "repo" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("detects a configured GitHub Enterprise remote", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(
      join(dir, ".git", "config"),
      `[remote "origin"]\n\turl = https://github.example.test/acme/widgets.git\n`,
    )
    try {
      expect(detectRepo(dir, "https://github.example.test")).toEqual({
        owner: "acme",
        repo: "widgets",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("falls back to another GitHub remote when origin is not GitHub", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    mkdirSync(join(dir, ".git"))
    writeFileSync(
      join(dir, ".git", "config"),
      `[remote "origin"]\n\turl = https://gitlab.com/foo/bar.git\n[remote "upstream"]\n\turl = git@github.com:octocat/Hello-World.git\n`,
    )
    try {
      expect(detectRepo(dir)).toEqual({
        owner: "octocat",
        repo: "Hello-World",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("returns null when no GitHub remotes exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"))
    try {
      expect(detectRepo(dir)).toBeNull()
      expect(currentBranch(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
