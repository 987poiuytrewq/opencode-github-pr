// Centralized user-facing error messages for the PR dashboard plugins.
//
// Message convention:
//   - Success messages are verb-specific and live in the tool/action
//     that produces them (e.g. "Requested review from @alice on PR #42").
//   - Tool/action failures use the generic `failed(msg)` fallback
//     ("Failed: <detail>"). The tool description provides context; the
//     error string just conveys what went wrong.
//   - Reusable domain states (no repo, no auth, rate limit, HTTP status
//     categories) have dedicated entries here because they're shared
//     across multiple actions.

export const errorMessages = {
  // auth
  noAuthToken:
    "Not authenticated, set GITHUB_TOKEN.",

  // repo / session context
  noRepo: "Not a git repo",

  // server-side tool errors
  prListing: {
    unauthorized: "Not authorised, check token is valid",
    forbidden: "Forbidden, check token scope",
    rateLimited: "Rate limited",
    notFound: "Repo not found",
    unprocessable: "Invalid query",
    timeout: "Timed out",
    network: (msg: string) => `Network error: ${msg}`,
    server: "GitHub server error",
    unknown: (msg: string) => msg,
  },

  // generic toast/tool failure fallback
  failed: (msg: string) => `Failed: ${msg}`,
  unknown: "unknown",

  // dashboard view banners / empty states
  noMatchingPRs: "No PRs match these filters",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// Map a thrown error to the right prListing message. Detects HTTP status
// (from @octokit/request-error), aborts/timeouts, network error codes, and
// GitHub request messages (when no status is available).
export function prListErrorMessage(e: unknown): string {
  if (!e) return errorMessages.prListing.unknown("unknown")
  const details = isRecord(e) ? e : {}
  const status = typeof details.status === "number" ? details.status : undefined
  const name = typeof details.name === "string" ? details.name : undefined
  const code = typeof details.code === "string" ? details.code : undefined
  const message = e instanceof Error ? e.message : String(e)
  const lower = message.toLowerCase()

  if (name === "AbortError") return errorMessages.prListing.timeout
  if (
    code &&
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  ) {
    return errorMessages.prListing.network(code)
  }

  switch (status) {
    case 401:
      return errorMessages.prListing.unauthorized
    case 403:
      return /rate limit/i.test(lower)
        ? errorMessages.prListing.rateLimited
        : errorMessages.prListing.forbidden
    case 404:
      return errorMessages.prListing.notFound
    case 408:
      return errorMessages.prListing.timeout
    case 422:
      return errorMessages.prListing.unprocessable
  }
  if (status && status >= 500) return errorMessages.prListing.server

  // GitHub request message fallback (no status, just text)
  if (/rate limit/i.test(lower)) return errorMessages.prListing.rateLimited
  if (/not found|\b404\b/.test(lower)) return errorMessages.prListing.notFound
  if (/unauthor|\b401\b/.test(lower)) return errorMessages.prListing.unauthorized
  if (/forbidden|\b403\b/.test(lower)) return errorMessages.prListing.forbidden
  if (/network|econn|enotfound|etimedout|eai_again/.test(lower)) {
    return errorMessages.prListing.network(message)
  }
  if (/timeout|timed out/.test(lower)) return errorMessages.prListing.timeout

  return errorMessages.prListing.unknown(message)
}

export type RateLimitInfo =
  | { isRateLimit: true; message: string; resetAt: number }
  | { isRateLimit: false; message: null; resetAt: null }

// Detects GitHub primary/secondary rate-limit errors and extracts the
// reset time from the x-ratelimit-reset header. Used by useDashboard to
// preserve the existing PR list when the error is a rate limit (the PRs
// are still valid; only the fetch failed).
export function parseRateLimitError(e: unknown): RateLimitInfo {
  const details = isRecord(e) ? e : {}
  const msg = typeof details.message === "string" ? details.message : ""
  const status = typeof details.status === "number" ? details.status : undefined
  const isRateLimit =
    status === 429 ||
    (status === 403 && /rate limit/i.test(msg)) ||
    /rate limit (already exceeded|exceeded)/i.test(msg) ||
    /api rate limit/i.test(msg)
  if (!isRateLimit) return { isRateLimit: false, message: null, resetAt: null }

  const response = isRecord(details.response) ? details.response : {}
  const headers = isRecord(response.headers)
    ? response.headers
    : isRecord(details.headers)
      ? details.headers
      : {}
  const rawReset = headers["x-ratelimit-reset"] ?? headers["X-RateLimit-Reset"]
  const resetAt = rawReset ? parseInt(String(rawReset), 10) * 1000 : null
  const resetText = resetAt ? new Date(resetAt).toLocaleTimeString() : "unknown time"

  let detail = `GitHub API rate limit exceeded — resets at ${resetText}.`
  if (/secondary rate limit/i.test(msg) || status === 429) {
    detail = `GitHub secondary rate limit hit (too many requests) — try again at ${resetText}.`
  }
  return { isRateLimit: true, message: detail, resetAt: resetAt ?? 0 }
}
