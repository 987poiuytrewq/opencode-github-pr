import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
} from "../helpers/octokit-mock"
import { makeFakeRepo } from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { createDashboard } from "../helpers/dashboard-fixture"
import { DashboardStatus } from "../../plugins/domain/types"
import {
  prListErrorKind,
  parseRateLimitError,
} from "../../plugins/domain/messages"
import { repositoryPRs } from "../../plugins/infra/loader"
import { createOctokit, setOctokit } from "../../plugins/infra/octokit"

beforeEach(() => installOctokitMock())
afterEach(() => clearOctokitMocks())

function graphQLError(
  type: string,
  path: string[],
  message = "GitHub GraphQL error",
): Error & {
  data: unknown
  errors: Array<{ type: string; path: string[]; message: string }>
} {
  return Object.assign(new Error(message), {
    data: { repository: null },
    errors: [{ type, path, message }],
  })
}

describe("GraphQL repository errors", () => {
  test("surfaces HTTP 200 NOT_FOUND instead of an empty PR list", async () => {
    const error = graphQLError("NOT_FOUND", ["repository"])
    mockOctokitDefault((op) => {
      if (op === "graphql") throw error
      return null
    })

    await expect(
      repositoryPRs({ owner: "missing-org", repo: "private-repo" }, 2),
    ).rejects.toBe(error)
    expect(prListErrorKind(error)).toBe("not-found")
  })

  test("surfaces SAML-style HTTP 200 FORBIDDEN errors", async () => {
    const error = graphQLError(
      "FORBIDDEN",
      ["repository"],
      "Resource protected by organization SAML enforcement",
    )
    mockOctokitDefault((op) => {
      if (op === "graphql") throw error
      return null
    })

    await expect(
      repositoryPRs({ owner: "enterprise-org", repo: "private-repo" }, 2),
    ).rejects.toBe(error)
    expect(prListErrorKind(error)).toBe("forbidden")
  })

  test("keeps usable PR data when only a nested field fails", async () => {
    const error = Object.assign(new Error("Field unavailable"), {
      data: {
        repository: {
          pullRequests: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 12,
                title: "Partial data PR",
                state: "OPEN",
                author: { login: "octocat" },
              },
            ],
          },
        },
      },
      errors: [
        {
          type: "FORBIDDEN",
          path: ["repository", "pullRequests", "nodes", 0, "assignees"],
          message: "Field unavailable",
        },
      ],
    })
    mockOctokitDefault((op) =>
      op === "graphql"
        ? (() => {
            throw error
          })()
        : null,
    )

    const result = await repositoryPRs({ owner: "octocat", repo: "repo" }, 2)
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0]?.number).toBe(12)
    expect(result.prs[0]?.assigneeLogins).toEqual([])
  })
})

describe("rate-limit handling", () => {
  test("retries short primary limits but rejects long primary limits without waiting", async () => {
    async function runPrimaryLimit(resetOffsetSeconds: number) {
      let calls = 0
      const fetchWithPrimaryLimit: typeof fetch = Object.assign(
        async () => {
          calls++
          if (calls > 1) {
            return new Response(
              JSON.stringify({ data: { viewer: { login: "octocat" } } }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            )
          }
          return new Response(
            JSON.stringify({ message: "API rate limit exceeded" }),
            {
              status: 403,
              headers: {
                "content-type": "application/json",
                "x-ratelimit-limit": "5000",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(
                  Math.floor(Date.now() / 1000) + resetOffsetSeconds,
                ),
              },
            },
          )
        },
        { preconnect: () => {} },
      )
      const client = createOctokit({
        token: "test-token",
        fetch: fetchWithPrimaryLimit,
      })
      setOctokit(client)
      try {
        await client.graphql("query { viewer { login } }")
      } catch {
        // Long primary limits should be surfaced, not retried.
      }
      return calls
    }

    expect(await runPrimaryLimit(1)).toBe(2)
    expect(await runPrimaryLimit(3600)).toBe(1)
  })

  test("uses Retry-After rather than the primary reset for secondary limits", () => {
    const now = Date.now()
    const resetEpoch = Math.floor(now / 1000) + 3600
    const error = Object.assign(
      new Error("You have exceeded a secondary rate limit"),
      {
        status: 403,
        response: {
          headers: {
            "retry-after": "30",
            "x-ratelimit-reset": String(resetEpoch),
          },
        },
      },
    )

    const info = parseRateLimitError(error)
    expect(info.isRateLimit).toBe(true)
    expect(info.isSecondary).toBe(true)
    if (info.isRateLimit)
      expect(info.resetAt).toBeGreaterThanOrEqual(now + 29_000)
    if (info.isRateLimit) expect(info.resetAt).toBeLessThan(now + 31_000)
  })

  test("uses the server Date header to correct primary reset times for local clock skew", () => {
    const originalNow = Date.now
    const localNow = Date.UTC(2026, 10, 20, 12, 0, 0)
    const serverNow = localNow + 5 * 60_000
    Date.now = () => localNow
    try {
      const error = Object.assign(new Error("API rate limit exceeded"), {
        status: 403,
        response: {
          headers: {
            date: new Date(serverNow).toUTCString(),
            "x-ratelimit-reset": String(Math.floor((serverNow + 90_000) / 1000)),
          },
        },
      })

      const info = parseRateLimitError(error)
      expect(info.isRateLimit).toBe(true)
      if (info.isRateLimit) {
        expect(info.resetAt).toBeGreaterThanOrEqual(localNow + 89_000)
        expect(info.resetAt).toBeLessThanOrEqual(localNow + 91_000)
      }
    } finally {
      Date.now = originalNow
    }
  })

  test("classifies GraphQL RATE_LIMITED errors as primary rate limits", () => {
    const error = Object.assign(new Error("GraphQL request failed"), {
      status: 200,
      errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
      response: {
        headers: {
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
        },
      },
    })

    expect(prListErrorKind(error)).toBe("rate-limit")
    const info = parseRateLimitError(error)
    expect(info.isRateLimit).toBe(true)
    expect(info.isSecondary).toBe(false)
  })

  test("suppresses refresh calls until the primary reset time", async () => {
    const cwd = makeFakeRepo()
    const originalCwd = process.cwd()
    const originalNow = Date.now
    let calls = 0
    process.chdir(cwd)
    try {
      mockOctokitDefault((op) => {
        if (op !== "graphql") return null
        calls++
        if (calls === 1) {
          const resetEpoch = Math.floor(originalNow() / 1000) + 3600
          throw Object.assign(new Error("API rate limit exceeded"), {
            status: 403,
            response: { headers: { "x-ratelimit-reset": String(resetEpoch) } },
          })
        }
        return {
          repository: {
            pullRequests: {
              totalCount: 0,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [],
            },
          },
        }
      })
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api)

      for (let i = 0; i < 50 && state().status !== DashboardStatus.Error; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(state().status).toBe(DashboardStatus.Error)
      expect(calls).toBe(1)

      await refresh()
      expect(calls).toBe(1)

      Date.now = () => originalNow() + 3_604_000
      await refresh()
      expect(calls).toBe(2)
      expect(state().status).toBe(DashboardStatus.Ok)
    } finally {
      Date.now = originalNow
      process.chdir(originalCwd)
    }
  })
})
