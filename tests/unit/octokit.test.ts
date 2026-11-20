import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { getAuthToken, getOctokit, invalidateOctokit, setOctokit } from "../../plugins/infra/octokit"

const authEnvKeys = ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_ENTERPRISE_URL"] as const
const originalAuthEnv = Object.fromEntries(authEnvKeys.map((key) => [key, process.env[key]]))

function restoreAuthEnvironment() {
  for (const key of authEnvKeys) {
    const value = originalAuthEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe("GitHub authentication token", () => {
  beforeEach(() => {
    for (const key of authEnvKeys) delete process.env[key]
    setOctokit(null)
  })

  afterEach(() => {
    setOctokit(null)
    restoreAuthEnvironment()
  })

  test("prefers configured environment tokens in order", async () => {
    expect(
      await getAuthToken(
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

    expect(await getAuthToken({ GH_TOKEN: "gh-token", GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token" }, () => undefined))
      .toBe("gh-token")
    expect(await getAuthToken({ GITHUB_PERSONAL_ACCESS_TOKEN: "personal-token" }, () => undefined))
      .toBe("personal-token")
  })

  test("awaits the GitHub CLI token lookup and passes the enterprise hostname", async () => {
    let requestedHostname: string | undefined
    const token = await getAuthToken(
      { GITHUB_ENTERPRISE_URL: "https://github.example.test" },
      async (hostname) => {
        requestedHostname = hostname
        await Promise.resolve()
        return "cli-token"
      },
    )

    expect(token).toBe("cli-token")
    expect(requestedHostname).toBe("github.example.test")
  })

  test("throws the authentication message when no token is available", async () => {
    await expect(getAuthToken({}, () => undefined)).rejects.toThrow("Not authenticated")
  })

  test("resolves credentials again when the API host changes and only invalidates the matching client", async () => {
    const resolvedTokens: string[] = []
    const resolveToken = async () => {
      const token = `token-${resolvedTokens.length + 1}`
      resolvedTokens.push(token)
      return token
    }

    const githubClient = await getOctokit(15_000, resolveToken)
    expect(await getOctokit(15_000, resolveToken)).toBe(githubClient)
    expect(resolvedTokens).toEqual(["token-1"])

    process.env.GITHUB_ENTERPRISE_URL = "https://github.example.test"
    const enterpriseClient = await getOctokit(15_000, resolveToken)
    expect(enterpriseClient).not.toBe(githubClient)
    expect(resolvedTokens).toEqual(["token-1", "token-2"])

    invalidateOctokit(githubClient)
    expect(await getOctokit(15_000, resolveToken)).toBe(enterpriseClient)
    expect(resolvedTokens).toEqual(["token-1", "token-2"])

    invalidateOctokit(enterpriseClient)
    expect(await getOctokit(15_000, resolveToken)).not.toBe(enterpriseClient)
    expect(resolvedTokens).toEqual(["token-1", "token-2", "token-3"])
  })
})
