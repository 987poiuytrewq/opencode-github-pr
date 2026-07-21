import { describe, expect, test } from "bun:test"
import { noRepoError } from "../../plugins/pr-dashboard"

describe("noRepoError", () => {
  test("includes the cwd path", () => {
    const out = noRepoError("/home/user/foo")
    expect(out).toContain("/home/user/foo")
    expect(out).toContain("Not a git repo")
  })
})
