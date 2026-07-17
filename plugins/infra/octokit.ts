// Octokit client factory for the PR dashboard.
//
// Auth: read the user's token via `gh auth token` (preserves the existing
// `gh` login flow and avoids re-implementing token storage). Fall back to
// GITHUB_TOKEN / GH_TOKEN env if `gh` is missing or unauthenticated.
//
// Plugins: throttling (respects X-RateLimit-Reset / Retry-After / secondary
// rate limits) and retry (handles 5xx and 429 with exponential backoff +
// jitter). doNotRetry covers 4xx that won't recover on their own.

import { Octokit } from "@octokit/rest"
import { throttling } from "@octokit/plugin-throttling"
import { retry } from "@octokit/plugin-retry"
import { runGh } from "./gh"

const OctokitWithPlugins = Octokit.plugin(throttling, retry)

export async function getAuthToken(): Promise<string> {
  const res = await runGh(["gh", "auth", "token"])
  if (res.ok && res.output) return res.output.trim()
  const envTok = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (envTok) return envTok
  throw new Error(
    `No GitHub auth token. Run \`gh auth login\` or set GITHUB_TOKEN. (gh: ${res.error ?? "no output"})`,
  )
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
    throttle: opts.throttle === false ? { enabled: false } : {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `[pr-dashboard] rate limit hit on ${options.method} ${options.url}; retry ${retryCount} after ${retryAfter}s`,
        )
        return retryCount < 3
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        octokit.log.warn(
          `[pr-dashboard] secondary rate limit on ${options.method} ${options.url}; waiting ${retryAfter}s`,
        )
        return true
      },
    },
    retry: opts.retry === false ? { enabled: false } : {
      doNotRetry: ["400", "401", "403", "404", "422"],
    },
  })
}

let cached: { token: string; client: Octokit } | null = null

export async function getOctokit(): Promise<Octokit> {
  if (cached) return cached.client
  const token = await getAuthToken()
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

let cachedUser: string | null = null

export async function currentUser(): Promise<string> {
  if (cachedUser) return cachedUser
  const octokit = await getOctokit()
  const { data } = await octokit.users.getAuthenticated()
  cachedUser = data.login
  return cachedUser
}

export function setCurrentUser(login: string | null): void {
  cachedUser = login
}
