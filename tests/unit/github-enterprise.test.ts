import { describe, expect, test } from "bun:test"
import { enterpriseApiBaseUrl } from "../../plugins/infra/github-enterprise"
import { createOctokit, getAuthToken } from "../../plugins/infra/octokit"

describe("GitHub Enterprise configuration", () => {
  test("uses /api/v3 for the REST and GraphQL API base URL", () => {
    const client = createOctokit({
      token: "enterprise-token",
      enterpriseUrl: "https://github.example.test",
      throttle: false,
      retry: false,
    })

    expect(client.request.endpoint.DEFAULTS.baseUrl).toBe("https://github.example.test/api/v3")
    expect(client.graphql.endpoint.DEFAULTS.baseUrl).toBe("https://github.example.test/api/v3")
  })

  test("routes GraphQL requests through the enterprise /api/graphql endpoint", async () => {
    let requestUrl = ""
    const client = createOctokit({
      token: "enterprise-token",
      enterpriseUrl: "https://github.example.test",
      throttle: false,
      retry: false,
      fetch: (async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return new Response(JSON.stringify({ data: { viewer: { login: "enterprise-user" } } }), {
          headers: { "content-type": "application/json" },
        })
      }) as typeof globalThis.fetch,
    })

    await client.graphql("query { viewer { login } }")

    expect(requestUrl).toBe("https://github.example.test/api/graphql")
  })

  test("accepts a configured /api/v3 URL without appending it twice", () => {
    expect(enterpriseApiBaseUrl("https://github.example.test/api/v3/")).toBe("https://github.example.test/api/v3")
  })

  test("rejects invalid or ambiguous enterprise URLs", () => {
    expect(() => enterpriseApiBaseUrl("not a URL")).toThrow("must be an absolute HTTPS URL")
    expect(() => enterpriseApiBaseUrl("http://github.example.test")).toThrow("must be an HTTPS server URL")
    expect(() => enterpriseApiBaseUrl("https://github.example.test/org")).toThrow(
      "must be the server URL or its /api/v3 API URL",
    )
    expect(() => enterpriseApiBaseUrl("https://user:secret@github.example.test")).toThrow(
      "without credentials, query, or fragment",
    )
  })

  test("requests the GitHub CLI token for the configured enterprise host", () => {
    let requestedHostname: string | undefined
    const token = getAuthToken({ GITHUB_ENTERPRISE_URL: "https://github.example.test" }, (hostname) => {
      requestedHostname = hostname
      return "enterprise-token"
    })

    expect(token).toBe("enterprise-token")
    expect(requestedHostname).toBe("github.example.test")
  })
})
