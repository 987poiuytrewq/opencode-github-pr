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
const OctokitWithPlugins = Octokit.plugin(throttling, retry)

function readGhAuthToken(): string | undefined {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
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
  ghAuthToken: () => string | undefined = readGhAuthToken,
): string {
  const token =
    env.GITHUB_TOKEN ||
    env.GH_TOKEN ||
    env.GITHUB_PERSONAL_ACCESS_TOKEN
  if (token) return token
  const ghToken = ghAuthToken()
  if (ghToken) return ghToken
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
      onRateLimit: (
        retryAfter: number,
        options: Required<EndpointDefaults>,
        octokit: CoreOctokit,
        retryCount: number,
      ) => {
        octokit.log.warn(
          `[pr-dashboard] rate limit hit on ${options.method} ${options.url}; retry ${retryCount} after ${retryAfter}s`,
        )
        return retryCount < 2
      },
      onSecondaryRateLimit: (
        retryAfter: number,
        options: Required<EndpointDefaults>,
        octokit: CoreOctokit,
      ) => {
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
