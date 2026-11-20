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
import { execFile } from "node:child_process"
import { errorMessages } from "../domain/messages"
import { enterpriseApiBaseUrl, enterpriseHostname } from "./github-enterprise"
const OctokitWithPlugins = Octokit.plugin(throttling, retry)

function readGhAuthToken(hostname?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const args = ["auth", "token"]
    if (hostname) args.push("--hostname", hostname)
    execFile("gh", args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
    }, (error, stdout) => {
      if (error) {
        resolve(undefined)
        return
      }
      const token = stdout.trim()
      resolve(token || undefined)
    })
  })
}

export async function getAuthToken(
  env: Record<string, string | undefined> = process.env,
  ghAuthToken: (hostname?: string) => string | undefined | Promise<string | undefined> = readGhAuthToken,
): Promise<string> {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN
  if (token) return token
  const ghToken = await ghAuthToken(enterpriseHostname(env.GITHUB_ENTERPRISE_URL) ?? undefined)
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

export async function getOctokit(
  requestTimeoutMs = 15_000,
  resolveToken: () => Promise<string> = getAuthToken,
): Promise<Octokit> {
  const enterpriseUrl = process.env.GITHUB_ENTERPRISE_URL
  const baseUrl = enterpriseApiBaseUrl(enterpriseUrl)
  if (cached?.baseUrl === baseUrl && cached.requestTimeoutMs === requestTimeoutMs) {
    return cached.client
  }
  // A token selected for github.com must not be carried across a host change:
  // gh may have a distinct credential for the enterprise hostname.
  const token = cached?.baseUrl === baseUrl ? cached.token : await resolveToken()
  const client = createOctokit({ token, requestTimeoutMs, enterpriseUrl })
  cached = { token, requestTimeoutMs, baseUrl, client }
  return client
}

export function invalidateOctokit(client: Octokit): void {
  if (cached?.client === client) cached = null
}

export function setOctokit(client: Octokit | null): void {
  if (client === null) {
    cached = null
  } else {
    cached = { token: "test", requestTimeoutMs: 15_000, baseUrl: null, client }
  }
}
