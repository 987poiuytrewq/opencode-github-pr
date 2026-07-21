import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseGitHubRemote, detectRepo } from "../../plugins/infra/git"
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
