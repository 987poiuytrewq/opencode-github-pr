// High-level data loaders for the PR dashboard.
// Backed by Octokit (REST + GraphQL), which gives us built-in throttling,
// retry, and timeouts.

import { getOctokit } from "./octokit"
import { currentBranch } from "./git"
import { type Repo, type PR } from "../domain/types"
import { parseReviewerTarget } from "../domain/reviewer-target"
import { mapPullFromGraphQL, mapPullFromREST } from "./mappers"
import { PULL_REQUESTS_QUERY } from "./queries"

export type { Repo, PR }

export const MAX_REPOSITORY_PR_PAGES = 3

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
async function graphqlPartial(query: string, vars: Record<string, unknown>): Promise<unknown> {
  try {
    return await getOctokit().graphql(query, vars)
  } catch (e: unknown) {
    if (isRecord(e) && "data" in e && e.data) return e.data
    throw e
  }
}

export async function addPullRequestReviewer(
  repo: Repo,
  pullNumber: number,
  reviewer: string,
): Promise<void> {
  if (!repo) throw new Error("no repo")
  if (!Number.isInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Pull request number must be a positive integer")
  }
  const target = parseReviewerTarget(reviewer, repo)
  if (!target) {
    throw new Error(`Reviewer must be a GitHub login or a team in ${repo.owner}/team format`)
  }
  const octokit = getOctokit()
  const request = {
    owner: repo.owner,
    repo: repo.repo,
    pull_number: pullNumber,
    ...(target.kind === "user"
      ? { reviewers: [target.login] }
      : { team_reviewers: [target.slug] }),
  }
  await octokit.pulls.requestReviewers(request)
}

export async function repositoryPRs(
  repo: Repo | null,
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
      head: null,
      after,
    })
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
  } while (hasNextPage && fetchedPages < MAX_REPOSITORY_PR_PAGES)
  return {
    prs: nodes.map(mapPullFromGraphQL),
    viewerLogin,
    listingTruncated: hasNextPage,
    fetchedPages,
  }
}

export async function currentBranchPRs(repo: Repo | null, cwd: string = process.cwd()): Promise<PR[]> {
  if (!repo) return []
  const branch = currentBranch(cwd)
  if (!branch) return []
  const data = await graphqlPartial(PULL_REQUESTS_QUERY, {
    owner: repo.owner,
    name: repo.repo,
    head: branch,
    after: null,
  })
  return readPullRequestPage(data).nodes.map(mapPullFromGraphQL)
}

export async function currentBranchPR(repo: Repo | null, cwd: string = process.cwd()): Promise<PR | null> {
  const prs = await currentBranchPRs(repo, cwd)
  return prs.find((pr) => !pr.isClosed) ?? null
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

export async function fetchOrgMembers(org: string): Promise<string[]> {
  try {
    const octokit = getOctokit()
    const members: string[] = []
    for await (const res of octokit.paginate.iterator(octokit.orgs.listMembers, {
      org,
      per_page: 100,
    })) {
      for (const m of res.data) {
        if (typeof m.login === "string") members.push(m.login)
      }
    }
    return members
  } catch {
    return []
  }
}
