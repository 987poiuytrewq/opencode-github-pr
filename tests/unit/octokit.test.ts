import { describe, expect, test } from "bun:test"
import { getAuthToken } from "../../plugins/infra/octokit"

describe("GitHub authentication token", () => {
  test("prefers configured environment tokens in order", () => {
    expect(
      getAuthToken(
        {
          GITHUB_TOKEN: "github-token",
          GH_TOKEN: "gh-token",
          GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token",
        },
        () => {
          throw new Error("gh should not be called when an environment token is set")
        },
      ),
    ).toBe("github-token")

    expect(
      getAuthToken(
        { GH_TOKEN: "gh-token", GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token" },
        () => undefined,
      ),
    ).toBe("gh-token")

    expect(
      getAuthToken({ GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token" }, () => undefined),
    ).toBe("personal-token")
  })

  test("uses the GitHub CLI token when no environment token is set", () => {
    expect(getAuthToken({}, () => "cli-token")).toBe("cli-token")
  })

  test("throws the authentication message when no token is available", () => {
    expect(() => getAuthToken({}, () => undefined)).toThrow("Not authenticated")
  })
})
