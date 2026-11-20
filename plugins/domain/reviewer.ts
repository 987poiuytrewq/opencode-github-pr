export type Reviewer =
  { kind: "user"; login: string } | { kind: "team"; slug: string }

const REVIEWER_SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,37}$/

export function parseReviewerInput(
  input: string,
  repositoryOwner: string,
): Reviewer {
  const value = input.trim().replace(/^@/, "")
  const parts = value.split("/")

  if (parts.length === 2) {
    const [organization, slug] = parts
    if (
      !REVIEWER_SLUG.test(organization) ||
      !REVIEWER_SLUG.test(slug) ||
      organization.toLowerCase() !== repositoryOwner.toLowerCase()
    ) {
      throw new Error(
        `Team reviewer must use ${repositoryOwner}/team-slug format.`,
      )
    }
    return { kind: "team", slug }
  }

  if (parts.length !== 1 || !REVIEWER_SLUG.test(value)) {
    throw new Error(
      "Reviewer must be a GitHub username or an organization/team slug.",
    )
  }

  return { kind: "user", login: value }
}
