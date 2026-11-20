import type { PRListErrorKind } from "./types"

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
    "Not authenticated; set a GitHub token or run `gh auth login`.",

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
  noMatchingPRs: "No matching PRs",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// Classify errors from GitHub HTTP status, aborts/timeouts, network codes,
// and request messages when no status is available.
export function prListErrorKind(e: unknown): PRListErrorKind {
  if (!e) return "unknown"
  const details = isRecord(e) ? e : {}
  const graphqlErrors = Array.isArray(details.errors) ? details.errors : []
  const graphqlTypes = graphqlErrors.filter(isRecord).map((error) => error.type)
  if (graphqlTypes.includes("NOT_FOUND")) return "not-found"
  if (graphqlTypes.includes("FORBIDDEN")) return "forbidden"
  if (graphqlTypes.includes("RATE_LIMITED")) return "rate-limit"
  const status = typeof details.status === "number" ? details.status : undefined
  const name = typeof details.name === "string" ? details.name : undefined
  const code = typeof details.code === "string" ? details.code : undefined
  const message = e instanceof Error ? e.message : String(e)
  const lower = message.toLowerCase()

  if (/not authenticated|unauthor/i.test(lower)) return "authentication"
  if (name === "AbortError") return "timeout"
  if (
    code &&
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  ) {
    return "network"
  }

  switch (status) {
    case 401:
      return "authentication"
    case 403:
      return /rate limit/i.test(lower) ? "rate-limit" : "forbidden"
    case 404:
      return "not-found"
    case 408:
      return "timeout"
    case 422:
      return "invalid-query"
  }
  if (status && status >= 500) return "server"

  // GitHub request message fallback (no status, just text)
  if (/rate limit/i.test(lower)) return "rate-limit"
  if (/not found|\b404\b/.test(lower)) return "not-found"
  if (/unauthor|\b401\b/.test(lower)) return "authentication"
  if (/forbidden|\b403\b/.test(lower)) return "forbidden"
  if (/network|econn|enotfound|etimedout|eai_again/.test(lower)) {
    return "network"
  }
  if (/timeout|timed out/.test(lower)) return "timeout"

  return "unknown"
}

// Map a thrown error to the existing user-facing detail string.
export function prListErrorMessage(e: unknown): string {
  if (!e) return errorMessages.prListing.unknown("unknown")
  const details = isRecord(e) ? e : {}
  const message = e instanceof Error ? e.message : String(e)
  const status = typeof details.status === "number" ? details.status : undefined
  const code = typeof details.code === "string" ? details.code : undefined

  switch (prListErrorKind(e)) {
    case "authentication":
      return status === 401 || /unauthor/i.test(message)
        ? errorMessages.prListing.unauthorized
        : errorMessages.noAuthToken
    case "forbidden":
      return errorMessages.prListing.forbidden
    case "rate-limit":
      return errorMessages.prListing.rateLimited
    case "not-found":
      return errorMessages.prListing.notFound
    case "invalid-query":
      return errorMessages.prListing.unprocessable
    case "timeout":
      return errorMessages.prListing.timeout
    case "network":
      return errorMessages.prListing.network(code ?? message)
    case "server":
      return errorMessages.prListing.server
    case "unknown":
      return errorMessages.prListing.unknown(message)
  }
}

export type RateLimitInfo =
  | { isRateLimit: true; message: string; resetAt: number; isSecondary: boolean }
  | { isRateLimit: false; message: null; resetAt: null; isSecondary: false }

// Detects GitHub primary/secondary rate-limit errors and extracts the
// reset time from x-ratelimit-reset or retry-after. Used by useDashboard to
// preserve the existing PR list when the error is a rate limit (the PRs
// are still valid; only the fetch failed).
export function parseRateLimitError(e: unknown): RateLimitInfo {
  const details = isRecord(e) ? e : {}
  const msg = typeof details.message === "string" ? details.message : ""
  const graphqlErrors = Array.isArray(details.errors) ? details.errors : []
  const hasGraphQLRateLimit = graphqlErrors.some((error) =>
    isRecord(error) && error.type === "RATE_LIMITED"
  )
  const status = typeof details.status === "number" ? details.status : undefined
  const isRateLimit =
    status === 429 ||
    (status === 403 && /rate limit/i.test(msg)) ||
    hasGraphQLRateLimit ||
    /rate limit (already exceeded|exceeded)/i.test(msg) ||
    /api rate limit/i.test(msg)
  if (!isRateLimit) return { isRateLimit: false, message: null, resetAt: null, isSecondary: false }

  const response = isRecord(details.response) ? details.response : {}
  const headers = isRecord(response.headers)
    ? response.headers
    : isRecord(details.headers)
      ? details.headers
      : {}
  const rawRetryAfter = headers["retry-after"] ?? headers["Retry-After"]
  const retryAfter = rawRetryAfter === undefined
    ? null
    : /^\d+(?:\.\d+)?$/.test(String(rawRetryAfter))
      ? Date.now() + Number(rawRetryAfter) * 1000
      : Number.isNaN(Date.parse(String(rawRetryAfter)))
        ? null
        : Date.parse(String(rawRetryAfter))
  const rawReset = headers["x-ratelimit-reset"] ?? headers["X-RateLimit-Reset"]
  const primaryReset = rawReset ? parseInt(String(rawReset), 10) * 1000 : null
  const isSecondary =
    /secondary rate limit/i.test(msg) || status === 429 || retryAfter !== null
  const resetAt = isSecondary ? retryAfter ?? primaryReset : primaryReset
  const resetText = resetAt ? new Date(resetAt).toLocaleTimeString() : "unknown time"

  let detail = `GitHub API rate limit exceeded — resets at ${resetText}.`
  if (isSecondary) {
    detail = `GitHub secondary rate limit hit (too many requests) — try again at ${resetText}.`
  }
  return { isRateLimit: true, message: detail, resetAt: resetAt ?? 0, isSecondary }
}
