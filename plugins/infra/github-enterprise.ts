export const GITHUB_ENTERPRISE_URL_ENV = "GITHUB_ENTERPRISE_URL"

const API_PATH_SUFFIX = "/api/v3"

export function enterpriseApiBaseUrl(value?: string): string | null {
  const configured = value?.trim()
  if (!configured) return null

  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new Error(`${GITHUB_ENTERPRISE_URL_ENV} must be an absolute HTTPS URL`)
  }

  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${GITHUB_ENTERPRISE_URL_ENV} must be an HTTPS server URL without credentials, query, or fragment`)
  }

  const path = url.pathname.replace(/\/+$/, "")
  if (path && !path.endsWith(API_PATH_SUFFIX)) {
    throw new Error(`${GITHUB_ENTERPRISE_URL_ENV} must be the server URL or its /api/v3 API URL`)
  }

  return `${url.origin}${path || API_PATH_SUFFIX}`
}

export function enterpriseHostname(value?: string): string | null {
  const baseUrl = enterpriseApiBaseUrl(value)
  return baseUrl ? new URL(baseUrl).hostname.toLowerCase() : null
}
