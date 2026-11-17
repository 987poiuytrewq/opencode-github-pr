// Octokit client factory for the PR dashboard.
// Auth: reads GITHUB_TOKEN / GH_TOKEN from the environment.
//
// Plugins: throttling (respects X-RateLimit-Reset / Retry-After / secondary
// rate limits) and retry (handles 5xx and 429 with exponential backoff +
// jitter). doNotRetry covers 4xx that won't recover on their own.

import { Octokit } from "@octokit/rest"
import { throttling } from "@octokit/plugin-throttling"
import { retry } from "@octokit/plugin-retry"
import { errorMessages } from "../domain/messages"
const OctokitWithPlugins = Octokit.plugin(throttling, retry)

export function getAuthToken(): string {
  const token =
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN
  if (token) return token
  throw new Error(errorMessages.noAuthToken)
}

export type OctokitOpts = {
  token?: string
  fetch?: typeof globalThis.fetch
  throttle?: boolean
  retry?: boolean
}

export function createOctokit(opts: OctokitOpts = {}): Octokit {
  return new OctokitWithPlugins({
    userAgent: "opencode-gh-pr",
    auth: opts.token,
    fetch: opts.fetch,
    request: { timeout: 15_000 },
    throttle: opts.throttle === false ? { enabled: false } : {
      onRateLimit: (retryAfter: number, options: any, octokit: any, retryCount: number) => {
        octokit.log.warn(
          `[pr-dashboard] rate limit hit on ${options.method} ${options.url}; retry ${retryCount} after ${retryAfter}s`,
        )
        return retryCount < 2
      },
      onSecondaryRateLimit: (retryAfter: number, options: any, octokit: any) => {
        octokit.log.warn(
          `[pr-dashboard] secondary rate limit on ${options.method} ${options.url}; would wait ${retryAfter}s, aborting`,
        )
        return false
      },
    },
    retry: opts.retry === false ? { enabled: false } : {
      doNotRetry: [400, 401, 403, 404, 422],
    },
  })
}

let cached: { token: string; client: Octokit } | null = null

export function getOctokit(): Octokit {
  if (cached) return cached.client
  const token = getAuthToken()
  const client = createOctokit({ token })
  cached = { token, client }
  return client
}

export function setOctokit(client: Octokit | null): void {
  if (client === null) {
    cached = null
  } else {
    cached = { token: "test", client }
  }
}
