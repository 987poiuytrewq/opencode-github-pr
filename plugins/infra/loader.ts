// High-level data loaders for the PR dashboard.
// Backed by Octokit (REST + GraphQL), which gives us built-in throttling,
// retry, and timeouts.

import { getOctokit } from "./octokit"
import { type Repo, type PR, type PRSearchPage } from "../domain/types"
import { mapPullFromGraphQL, mapPullFromREST } from "./mappers"
import { SEARCH_PULL_REQUESTS_QUERY } from "./queries"

export type { Repo, PR, PRSearchPage }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readSearchPage(value: unknown): PRSearchPage {
  const root = isRecord(value) ? value : {}
  const viewer = isRecord(root.viewer) ? root.viewer : {}
  const connection = isRecord(root.search) ? root.search : {}
  const pageInfo = isRecord(connection.pageInfo) ? connection.pageInfo : {}
  // Search can return other node types; only PullRequest nodes have fields.
  const nodes = Array.isArray(connection.nodes)
    ? connection.nodes.filter((node) => isRecord(node) && typeof node.number === "number")
    : []
  const totalCount = typeof connection.issueCount === "number" ? connection.issueCount : nodes.length
  return {
    prs: nodes.map(mapPullFromGraphQL),
    viewerLogin: typeof viewer.login === "string" ? viewer.login : null,
    totalCount,
    hasNextPage: pageInfo.hasNextPage === true,
    endCursor: typeof pageInfo.endCursor === "string" && pageInfo.endCursor ? pageInfo.endCursor : null,
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

// Fetch one page of PRs matching a search query built by prSearchQuery.
// `after` is the endCursor of the previous page, or null for the first.
export async function searchPRs(
  query: string,
  first: number,
  after: string | null,
  requestTimeoutMs = 15_000,
): Promise<PRSearchPage> {
  const data = await graphqlPartial(SEARCH_PULL_REQUESTS_QUERY, { query, first, after }, requestTimeoutMs)
  return readSearchPage(data)
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
