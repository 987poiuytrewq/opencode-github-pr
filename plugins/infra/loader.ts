// High-level data loaders for the PR dashboard.
// Backed by Octokit (REST + GraphQL), which gives us built-in throttling,
// retry, and timeouts.

import { getOctokit } from "./octokit"
import { type Repo, type PR, type PRScope, type PRStatusFilter } from "../domain/types"
import { mapPullFromGraphQL, mapPullFromREST } from "./mappers"
import { PULL_REQUESTS_QUERY, PULL_REQUESTS_SEARCH_QUERY } from "./queries"

export type { Repo, PR }

export const MIN_PAGES_PER_BATCH = 4
export const DEFAULT_TUI_PAGES_PER_BATCH = 4
export const DEFAULT_PR_BATCH_SIZE = 4
export const MAX_SEARCH_RESULTS = 1_000
export const DEFAULT_RECENT_PRS_LIMIT = 5
export const MAX_RECENT_PRS_LIMIT = 100

// Status is pushed into GitHub's GraphQL query so each listing has its own
// cursor and closed PRs cannot displace open PRs (or vice versa).
export type PRListing = PRStatusFilter

const LISTING_STATES: Record<PRListing, string[]> = {
  open: ["OPEN"],
  closed: ["CLOSED", "MERGED"],
  all: ["OPEN", "CLOSED", "MERGED"],
}

export type RepositoryPRsResult = {
  prs: PR[]
  viewerLogin: string | null
  totalCount: number | null
  searchResultsFetched: number
  supplementalPRCount: number
  hasMore: boolean
  fetchedPages: number
  endCursor: string | null
  limitReached: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readPullRequestPage(value: unknown, connectionName: "pullRequests" | "search"): {
  nodes: unknown[]
  viewerLogin: string | null
  totalCount: number | null
  hasNextPage: boolean
  endCursor: string | null
} {
  const root = isRecord(value) ? value : {}
  const viewer = isRecord(root.viewer) ? root.viewer : {}
  const repository = isRecord(root.repository) ? root.repository : {}
  const rawConnection = connectionName === "search" ? root.search : repository.pullRequests
  const connection = isRecord(rawConnection) ? rawConnection : {}
  const pageInfo = isRecord(connection.pageInfo) ? connection.pageInfo : {}
  const rawTotalCount = connectionName === "search" ? connection.issueCount : connection.totalCount
  return {
    nodes: Array.isArray(connection.nodes) ? connection.nodes.filter((node) => node != null) : [],
    viewerLogin: typeof viewer.login === "string" ? viewer.login : null,
    totalCount: typeof rawTotalCount === "number" && Number.isFinite(rawTotalCount)
      ? rawTotalCount
      : null,
    hasNextPage: pageInfo.hasNextPage === true,
    endCursor: typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null,
  }
}

function readRecentPullRequests(value: unknown): unknown[] {
  const root = isRecord(value) ? value : {}
  const repository = isRecord(root.repository) ? root.repository : {}
  const connection = isRecord(repository.recentPullRequests) ? repository.recentPullRequests : {}
  return Array.isArray(connection.nodes) ? connection.nodes.filter((node) => node != null) : []
}

function matchesSearchScope(pr: PR, scope: PRScope, viewerLogin: string | null): boolean {
  if (!viewerLogin) return false
  const login = viewerLogin.toLowerCase()
  return scope === "author"
    ? pr.authorLogin.toLowerCase() === login
    : scope === "assignee" && pr.assigneeLogins.some((assignee) => assignee.toLowerCase() === login)
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
  batchSize = DEFAULT_PR_BATCH_SIZE,
  requestTimeoutMs = 15_000,
  listing: PRListing = "open",
  after: string | null = null,
  scope: PRScope = "all",
  scopeValue: string | null = null,
  resultsAlreadyFetched = 0,
  recentPRsLimit = DEFAULT_RECENT_PRS_LIMIT,
): Promise<RepositoryPRsResult> {
  if (!repo) {
    return {
      prs: [],
      viewerLogin: null,
      totalCount: 0,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      hasMore: false,
      fetchedPages: 0,
      endCursor: null,
      limitReached: false,
    }
  }
  if (scope === "branch" && !scopeValue) {
    return {
      prs: [],
      viewerLogin: null,
      totalCount: 0,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      hasMore: false,
      fetchedPages: 0,
      endCursor: null,
      limitReached: false,
    }
  }
  const isSearch = scope === "author" || scope === "assignee"
  const requestedRecords = isSearch
    ? Math.min(batchSize, Math.max(0, MAX_SEARCH_RESULTS - resultsAlreadyFetched))
    : batchSize
  if (requestedRecords <= 0) {
    return {
      prs: [],
      viewerLogin: null,
      totalCount: isSearch ? Math.min(resultsAlreadyFetched, MAX_SEARCH_RESULTS) : null,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      hasMore: false,
      fetchedPages: 0,
      endCursor: after,
      limitReached: isSearch,
    }
  }
  const searchQuery = isSearch
    ? [
        `repo:${repo.owner}/${repo.repo}`,
        "is:pr",
        scope === "author" ? "author:@me" : "assignee:@me",
        listing === "open" ? "is:open" : listing === "closed" ? "is:closed" : null,
        "sort:updated-desc",
      ].filter(Boolean).join(" ")
    : null
  const nodes: unknown[] = []
  let cursor = after
  let viewerLogin: string | null = null
  let totalCount: number | null = null
  let fetchedPages = 0
  let searchResultsFetched = 0
  let recentNodes: unknown[] = []
  let hasNextPage = false
  let endCursor: string | null = null
  let remainingRecords = requestedRecords
  let consecutiveEmptyPages = 0
  const seenCursors = new Set<string>(cursor ? [cursor] : [])
  do {
    const first = Math.min(100, remainingRecords)
    const includeRecentPRs =
      isSearch &&
      recentPRsLimit > 0 &&
      !cursor &&
      resultsAlreadyFetched === 0
    const data = isSearch
      ? await graphqlPartial(PULL_REQUESTS_SEARCH_QUERY, {
          owner: repo.owner,
          name: repo.repo,
          states: LISTING_STATES[listing],
          searchQuery,
          after: cursor,
          first,
          recentPRsLimit: Math.min(MAX_RECENT_PRS_LIMIT, Math.max(1, Math.floor(recentPRsLimit))),
          includeRecentPRs,
        }, requestTimeoutMs)
      : await graphqlPartial(PULL_REQUESTS_QUERY, {
          owner: repo.owner,
          name: repo.repo,
          states: LISTING_STATES[listing],
          head: scope === "branch" ? scopeValue : null,
          after: cursor,
          first,
        }, requestTimeoutMs)
    const page = readPullRequestPage(data, isSearch ? "search" : "pullRequests")
    nodes.push(...page.nodes)
    if (isSearch) {
      searchResultsFetched += page.nodes.length
      if (includeRecentPRs) recentNodes = readRecentPullRequests(data)
    }
    remainingRecords -= page.nodes.length
    consecutiveEmptyPages = page.nodes.length === 0 ? consecutiveEmptyPages + 1 : 0
    if (page.viewerLogin) viewerLogin = page.viewerLogin
    if (page.totalCount !== null) {
      totalCount = isSearch ? Math.min(page.totalCount, MAX_SEARCH_RESULTS) : page.totalCount
    }
    hasNextPage = page.hasNextPage
    endCursor = page.endCursor
    fetchedPages++
    if (!hasNextPage) {
      break
    }
    const nextCursor = endCursor
    if (typeof nextCursor !== "string" || nextCursor.length === 0 || seenCursors.has(nextCursor)) {
      throw new Error("GitHub returned an invalid or repeated pull request pagination cursor")
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
    if (consecutiveEmptyPages >= 3) break
  } while (hasNextPage && remainingRecords > 0)
  const searchPRs = nodes.map(mapPullFromGraphQL)
  let supplementalPRs: PR[] = []
  if (isSearch && recentNodes.length > 0 && viewerLogin) {
    const knownNumbers = new Set(searchPRs.map((pr) => pr.number))
    supplementalPRs = recentNodes
      .map(mapPullFromGraphQL)
      .filter((pr) => matchesSearchScope(pr, scope, viewerLogin) && !knownNumbers.has(pr.number))
    const uniqueNumbers = new Set<number>()
    supplementalPRs = supplementalPRs.filter((pr) => {
      if (uniqueNumbers.has(pr.number)) return false
      uniqueNumbers.add(pr.number)
      return true
    })
  }
  const limitReached = isSearch &&
    hasNextPage &&
    resultsAlreadyFetched + nodes.length >= MAX_SEARCH_RESULTS
  return {
    prs: [...supplementalPRs, ...searchPRs],
    viewerLogin,
    totalCount: totalCount === null ? null : totalCount + supplementalPRs.length,
    searchResultsFetched,
    supplementalPRCount: supplementalPRs.length,
    hasMore: hasNextPage && !limitReached,
    fetchedPages,
    endCursor,
    limitReached,
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
