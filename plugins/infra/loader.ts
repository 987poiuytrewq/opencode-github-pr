// High-level data loaders for the PR dashboard.
// Backed by Octokit (REST + GraphQL), which gives us built-in throttling,
// retry, and timeouts.

import { getOctokit } from "./octokit"
import { type Repo, type PR } from "../domain/types"
import { mapPullFromGraphQL, mapPullFromREST } from "./mappers"
import { PULL_REQUESTS_QUERY } from "./queries"

export type { Repo, PR }

export const MAX_REPOSITORY_PR_PAGES = 1

// Which PRs a listing covers. Open PRs are loaded on their own so that a
// backlog of closed PRs can't push them out of the page limit.
export type PRListing = "open" | "closed"

const LISTING_STATES: Record<PRListing, string[]> = {
  open: ["OPEN"],
  closed: ["CLOSED", "MERGED"],
}

export type RepositoryPRsResult = {
  prs: PR[]
  viewerLogin: string | null
  listingTruncated: boolean
  fetchedPages: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readPullRequestPage(value: unknown): {
  nodes: unknown[]
  viewerLogin: string | null
  hasNextPage: boolean
  endCursor: string | null
} {
  const root = isRecord(value) ? value : {}
  const viewer = isRecord(root.viewer) ? root.viewer : {}
  const repository = isRecord(root.repository) ? root.repository : {}
  const connection = isRecord(repository.pullRequests) ? repository.pullRequests : {}
  const pageInfo = isRecord(connection.pageInfo) ? connection.pageInfo : {}
  return {
    nodes: Array.isArray(connection.nodes) ? connection.nodes.filter((node) => node != null) : [],
    viewerLogin: typeof viewer.login === "string" ? viewer.login : null,
    hasNextPage: pageInfo.hasNextPage === true,
    endCursor: typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null,
  }
}

// Wraps octokit.graphql to return partial data when some fields error.
// GitHub's GraphQL API returns both `data` and `errors` when specific
// fields are inaccessible. Octokit throws on any errors, but the partial
// data is still usable — errored fields are null in the response.
async function graphqlPartial(
  query: string,
  vars: Record<string, unknown>,
  requestTimeoutMs: number,
): Promise<unknown> {
  try {
    return await getOctokit(requestTimeoutMs).graphql(query, vars)
  } catch (e: unknown) {
    if (isRecord(e) && "data" in e && e.data) return e.data
    throw e
  }
}

export async function repositoryPRs(
  repo: Repo | null,
  maxPages = MAX_REPOSITORY_PR_PAGES,
  requestTimeoutMs = 15_000,
  listing: PRListing = "open",
): Promise<RepositoryPRsResult> {
  if (!repo) return { prs: [], viewerLogin: null, listingTruncated: false, fetchedPages: 0 }
  const nodes: unknown[] = []
  let after: string | null = null
  let viewerLogin: string | null = null
  let fetchedPages = 0
  let hasNextPage = false
  const seenCursors = new Set<string>()
  do {
    const data = await graphqlPartial(PULL_REQUESTS_QUERY, {
      owner: repo.owner,
      name: repo.repo,
      states: LISTING_STATES[listing],
      head: null,
      after,
    }, requestTimeoutMs)
    const page = readPullRequestPage(data)
    nodes.push(...page.nodes)
    if (page.viewerLogin) viewerLogin = page.viewerLogin
    hasNextPage = page.hasNextPage
    fetchedPages++
    if (!hasNextPage) {
      after = null
      break
    }
    const nextCursor = page.endCursor
    if (typeof nextCursor !== "string" || nextCursor.length === 0 || seenCursors.has(nextCursor)) {
      throw new Error("GitHub returned an invalid or repeated pull request pagination cursor")
    }
    seenCursors.add(nextCursor)
    after = nextCursor
  } while (hasNextPage && fetchedPages < maxPages)
  return {
    prs: nodes.map(mapPullFromGraphQL),
    viewerLogin,
    listingTruncated: hasNextPage,
    fetchedPages,
  }
}

export async function fetchOnePR(repo: Repo, pullNumber: number): Promise<PR> {
  const octokit = getOctokit()
  const { data } = await octokit.pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: pullNumber,
  })
  return mapPullFromREST(data)
}
