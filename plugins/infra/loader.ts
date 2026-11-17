// High-level data loaders for the PR dashboard.
// Backed by Octokit (REST + GraphQL), which gives us built-in throttling,
// retry, and timeouts.

import { getOctokit } from "./octokit"
import { currentBranch } from "./git"
import { PRFilter, type Repo, type ReviewThread, type PR } from "../domain/types"
import { mapPullFromSearch, mapPullFromREST } from "./mappers"
import {
  DASHBOARD_QUERY,
  PR_LOOKUP_QUERY,
  REVIEWER_THREADS_QUERY,
  VIEWER_QUERY,
} from "./queries"

export type { PRFilter, Repo, PR }

// Wraps octokit.graphql to return partial data when some fields error.
// GitHub's GraphQL API returns both `data` and `errors` when specific
// fields are inaccessible. Octokit throws on any errors, but the partial
// data is still usable — errored fields are null in the response.
async function graphqlPartial(query: string, vars: Record<string, unknown>): Promise<any> {
  try {
    return await getOctokit().graphql(query, vars)
  } catch (e: any) {
    if (e?.data) return e.data
    throw e
  }
}

export async function fetchDashboardData(
  filter: PRFilter,
  repo: Repo | null,
  viewerLogin?: string | null,
): Promise<PR[]> {
  if (!repo) return []
  const data: any = await graphqlPartial(DASHBOARD_QUERY, {
    owner: repo.owner,
    name: repo.repo,
  })
  const nodes: any[] = data?.repository?.pullRequests?.nodes ?? []
  const prs = nodes.filter(Boolean).map(mapPullFromSearch)
  if (!viewerLogin) return prs
  // Client-side filter: the search API supported author:/assignee: qualifiers
  // but required extra scope to read statusCheckRollup.  We switched to the
  // direct connection for CI status, so filtering moves here.
  const lower = viewerLogin.toLowerCase()
  if (filter === PRFilter.Author) {
    return prs.filter((p) => p._authorLogin?.toLowerCase() === lower)
  }
  return prs.filter((p) =>
    p._assigneeLogins?.some((l: string) => l.toLowerCase() === lower),
  )
}

let cachedViewerLogin: string | null = null

export async function fetchViewerLogin(): Promise<string | null> {
  if (cachedViewerLogin) return cachedViewerLogin
  try {
    const data: any = await graphqlPartial(VIEWER_QUERY, {})
    const login = data?.viewer?.login
    if (login) cachedViewerLogin = login
    return login ?? null
  } catch {
    return null
  }
}

export async function addPullRequestReviewer(
  repo: Repo,
  pullNumber: number,
  reviewer: string,
): Promise<void> {
  if (!repo) throw new Error("no repo")
  const octokit = getOctokit()
  await octokit.pulls.requestReviewers({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: pullNumber,
    reviewers: [reviewer],
  })
}

export async function currentBranchPR(repo: Repo | null, cwd: string = process.cwd()): Promise<PR | null> {
  if (!repo) return null
  const branch = currentBranch(cwd)
  if (!branch) return null
  const data: any = await graphqlPartial(PR_LOOKUP_QUERY, {
    owner: repo.owner,
    name: repo.repo,
    head: branch,
  })
  const nodes: any[] = data?.repository?.pullRequests?.nodes ?? []
  const pr = nodes.filter(Boolean)[0]
  return pr ? mapPullFromSearch(pr) : null
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

export async function fetchReviewerThreads(
  owner: string,
  repo: string,
  prNumber: number,
  reviewerLogin: string,
): Promise<ReviewThread[]> {
  try {
    const octokit = getOctokit()
    const data: any = await octokit.graphql(REVIEWER_THREADS_QUERY, {
      owner,
      name: repo,
      number: prNumber,
    })
    const threads: any[] = data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
    const normalize = (l: string) => l.replace(/\[bot\]$/, "")
    const target = normalize(reviewerLogin)
    const out: ReviewThread[] = []
    for (const t of threads) {
      if (t.isResolved) continue
      const comments: any[] = t.comments?.nodes ?? []
      const hasReviewer = comments.some(
        (c: any) => normalize(c.author?.login ?? "") === target,
      )
      if (!hasReviewer) continue
      const own = comments.filter(
        (c: any) => normalize(c.author?.login ?? "") === target,
      )
      const c = own[0] ?? comments[0]
      out.push({
        isResolved: false,
        author: (c.author?.login ?? "").replace(/\[bot\]$/, ""),
        body: own.map((x: any) => (x.body ?? "").replace(/\n/g, " ")).join(" | "),
        createdAt: c.createdAt ?? "",
        path: c.path ?? "—",
        line: c.line != null ? c.line : null,
      })
    }
    return out
  } catch (e: any) {
    throw new Error(`Failed to fetch threads: ${e?.message ?? "unknown error"}`)
  }
}

export async function fetchOrgMembers(org: string): Promise<string[]> {
  try {
    const octokit = getOctokit()
    const members: string[] = []
    for await (const res of octokit.paginate.iterator(octokit.orgs.listMembers, {
      org,
      per_page: 100,
    })) {
      for (const m of res.data) members.push(m.login)
    }
    return members
  } catch {
    return []
  }
}
