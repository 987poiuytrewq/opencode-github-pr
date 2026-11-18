import type { Repo } from "./types"

export type ReviewerTarget =
  | { kind: "user"; login: string }
  | { kind: "team"; organization: string; slug: string }

const GITHUB_SLUG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/

/**
 * Accept only a GitHub login or an explicit org/team pair for this repository.
 * The caller may normalize a leading @ for interactive input before calling.
 */
export function parseReviewerTarget(value: unknown, repo: Repo): ReviewerTarget | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return null

  const parts = value.split("/")
  if (parts.length === 1) {
    const login = parts[0]
    return login.length <= 39 && GITHUB_SLUG.test(login)
      ? { kind: "user", login }
      : null
  }

  if (parts.length !== 2) return null
  const [organization, slug] = parts
  if (
    !GITHUB_SLUG.test(organization) ||
    !GITHUB_SLUG.test(slug) ||
    organization.toLowerCase() !== repo.owner.toLowerCase()
  ) {
    return null
  }
  return { kind: "team", organization, slug }
}
