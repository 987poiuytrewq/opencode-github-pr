// Octokit client factory for the PR dashboard.
// Auth: reads a GitHub token from the environment, then falls back to `gh auth token`.
//
// Plugins: throttling (respects X-RateLimit-Reset / Retry-After / secondary
// rate limits) and retry (handles 5xx and 429 with exponential backoff +
// jitter). doNotRetry covers 4xx that won't recover on their own.

import { Octokit } from "@octokit/rest"
import type { Octokit as CoreOctokit } from "@octokit/core"
import type { EndpointDefaults } from "@octokit/types"
import { throttling } from "@octokit/plugin-throttling"
import { retry } from "@octokit/plugin-retry"
import { execFileSync } from "node:child_process"
import { errorMessages } from "../domain/messages"
import { enterpriseApiBaseUrl, enterpriseHostname } from "./github-enterprise"
const OctokitWithPlugins = Octokit.plugin(throttling, retry)

function readGhAuthToken(hostname?: string): string | undefined {
  try {
    const args = ["auth", "token"]
    if (hostname) args.push("--hostname", hostname)
    const token = execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim()
    return token || undefined
  } catch {
    return undefined
  }
}

export function getAuthToken(
  env: Record<string, string | undefined> = process.env,
  ghAuthToken: (hostname?: string) => string | undefined = readGhAuthToken,
): string {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN
  if (token) return token
  const ghToken = ghAuthToken(enterpriseHostname(env.GITHUB_ENTERPRISE_URL) ?? undefined)
  if (ghToken) return ghToken
  throw new Error(errorMessages.noAuthToken)
}

export type OctokitOpts = {
  token?: string
  enterpriseUrl?: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  throttle?: boolean
  retry?: boolean
}

export function createOctokit(opts: OctokitOpts = {}): Octokit {
  return new OctokitWithPlugins({
    userAgent: "opencode-gh-pr",
    auth: opts.token,
    baseUrl: enterpriseApiBaseUrl(opts.enterpriseUrl) ?? undefined,
    request: { timeout: opts.requestTimeoutMs ?? 15_000, fetch: opts.fetch },
    throttle:
      opts.throttle === false
        ? { enabled: false }
        : {
            onRateLimit: (
              retryAfter: number,
              options: Required<EndpointDefaults>,
              octokit: CoreOctokit,
              retryCount: number,
            ) => {
              octokit.log.warn(
                `[pr-dashboard] rate limit hit on ${options.method} ${options.url}; retry ${retryCount} after ${retryAfter}s`,
              )
              // Primary limits can last for an hour or more. Only let the
              // plugin retry brief waits; longer cooldowns are surfaced to
              // the dashboard so it can stop scheduling more requests.
              return retryCount < 2 && retryAfter <= 5
            },
            onSecondaryRateLimit: (retryAfter: number, options: Required<EndpointDefaults>, octokit: CoreOctokit) => {
              octokit.log.warn(
                `[pr-dashboard] secondary rate limit on ${options.method} ${options.url}; would wait ${retryAfter}s, aborting`,
              )
              return false
            },
          },
    retry:
      opts.retry === false
        ? { enabled: false }
        : {
            doNotRetry: [400, 401, 403, 404, 422],
          },
  })
}

let cached: {
  token: string
  requestTimeoutMs: number
  baseUrl: string | null
  client: Octokit
} | null = null

export function getOctokit(requestTimeoutMs = 15_000): Octokit {
  const enterpriseUrl = process.env.GITHUB_ENTERPRISE_URL
  const baseUrl = enterpriseApiBaseUrl(enterpriseUrl)
  if (cached?.baseUrl === baseUrl && cached.requestTimeoutMs === requestTimeoutMs) {
    return cached.client
  }
  const token = cached?.token ?? getAuthToken()
  const client = createOctokit({ token, requestTimeoutMs, enterpriseUrl })
  cached = { token, requestTimeoutMs, baseUrl, client }
  return client
}

export function setOctokit(client: Octokit | null): void {
  if (client === null) {
    cached = null
  } else {
    cached = { token: "test", requestTimeoutMs: 15_000, baseUrl: null, client }
  }
}
