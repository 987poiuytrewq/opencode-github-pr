// High-level data loaders for the PR dashboard.
//
// Backed by Octokit (REST + GraphQL), which gives us built-in throttling,
// retry, and timeouts — replacing the per-call `gh` spawn approach. The
// caller-facing shape of each function is unchanged.

import { getOctokit, currentUser } from "./octokit"
import { originRemoteUrl, parseGitHubRemote, currentBranch, type Repo as GitRepo } from "./git"
import type { Filter, ReviewerThreadCounts, TuiPR } from "../domain/types"

export type { Filter, ReviewerThreadCounts, TuiPR }

export type Repo = GitRepo

export function detectRepo(cwd: string = process.cwd()): Repo {
  const url = originRemoteUrl(cwd)
  if (!url) return null
  return parseGitHubRemote(url)
}

type OctokitPull = Awaited<ReturnType<Awaited<ReturnType<typeof getOctokit>>["pulls"]["list"]>>["data"][number]

function mapPull(p: OctokitPull): TuiPR {
  return {
    number: p.number,
    title: p.title,
    url: p.html_url,
    isDraft: p.draft ?? false,
    author: p.user ? { login: p.user.login } : null,
    headRefName: p.head.ref,
    baseRefName: p.base.ref,
    reviewDecision: p.review_decision ?? null,
    mergeable: p.mergeable ? "MERGEABLE" : p.mergeable === false ? "CONFLICTING" : "UNKNOWN",
    mergeStateStatus: p.mergeable_state ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    statusCheckRollup: p.status_check_rollup ?? null,
    reviewRequests: (p.requested_reviewers ?? []).map((r) => ({ login: r.login })),
    latestReviews: (p.latest_reviews ?? []).map((r) => ({
      author: { login: r.user?.login ?? "" },
      state: r.state,
      createdAt: r.submitted_at ?? "",
    })),
    assignees: (p.assignees ?? []).map((a) => ({ login: a.login })),
  }
}

export async function fetchPRs(filter: Filter, repo: GitRepo): Promise<TuiPR[]> {
  if (!repo) return []
  const octokit = await getOctokit()
  const { data } = await octokit.pulls.list({
    owner: repo.owner,
    repo: repo.repo,
    state: "open",
    per_page: 50,
    sort: "updated",
    direction: "desc",
  })
  const me = filter === "all" ? null : await currentUser()
  const filtered =
    filter === "author"
      ? data.filter((p) => p.user?.login === me)
      : filter === "assigned"
        ? data.filter((p) => p.assignees?.some((a) => a.login === me))
        : data
  return filtered.map(mapPull)
}

export async function currentBranchPR(repo: GitRepo, cwd: string = process.cwd()): Promise<TuiPR | null> {
  if (!repo) return null
  const branch = currentBranch(cwd)
  if (!branch) return null
  const me = await currentUser()
  const octokit = await getOctokit()
  const { data } = await octokit.pulls.list({
    owner: repo.owner,
    repo: repo.repo,
    state: "open",
    head: `${me}:${branch}`,
    per_page: 1,
  })
  const pr = data[0]
  return pr ? mapPull(pr) : null
}

export const THREAD_COUNT_QUERY = `query Q($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        reviewThreads(first: 100) {
          totalCount
          nodes {
            isResolved
            comments(first: 20) {
              nodes {
                author { login }
              }
            }
          }
        }
      }
    }
  }
}`

export async function fetchReviewerThreadCounts(
  owner: string,
  repo: string,
): Promise<Map<number, ReviewerThreadCounts>> {
  const out = new Map<number, ReviewerThreadCounts>()
  try {
    const octokit = await getOctokit()
    const data: any = await octokit.graphql(THREAD_COUNT_QUERY, { owner, name: repo })
    const nodes = data?.repository?.pullRequests?.nodes ?? []
    const normalize = (l: string) => l.replace(/\[bot\]$/, "")
    for (const n of nodes) {
      const threads = n.reviewThreads?.nodes ?? []
      const byReviewer = new Map<string, { unresolved: number; resolved: number }>()
      const bump = (login: string, kind: "unresolved" | "resolved") => {
        const key = normalize(login)
        if (!key) return
        const cur = byReviewer.get(key) ?? { unresolved: 0, resolved: 0 }
        cur[kind]++
        byReviewer.set(key, cur)
      }
      for (const t of threads) {
        const authors = new Set<string>()
        for (const c of t.comments?.nodes ?? []) {
          const a = c.author?.login
          if (a) authors.add(a)
        }
        for (const a of authors) {
          bump(a, t.isResolved ? "resolved" : "unresolved")
        }
      }
      out.set(n.number, byReviewer)
    }
  } catch {}
  return out
}

export const REVIEWER_THREADS_QUERY = `query Q($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        totalCount
        nodes {
          isResolved
          comments(first: 20) {
            nodes {
              author { login }
              body
              createdAt
              path
              line
            }
          }
        }
      }
    }
  }
}`

export async function fetchReviewerThreads(
  owner: string,
  repo: string,
  prNumber: number,
  reviewerLogin: string,
): Promise<string> {
  try {
    const octokit = await getOctokit()
    const data: any = await octokit.graphql(REVIEWER_THREADS_QUERY, {
      owner,
      name: repo,
      number: prNumber,
    })
    const threads: any[] = data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
    const normalize = (l: string) => l.replace(/\[bot\]$/, "")
    const target = normalize(reviewerLogin)
    const rows: string[] = []
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
      const author = (c.author?.login ?? "").replace(/\[bot\]$/, "")
      const file = c.path ?? "—"
      const line = c.line != null ? String(c.line) : "—"
      const body = own.map((x: any) => (x.body ?? "").replace(/\n/g, " ")).join(" | ")
      const bodyTrim = body.slice(0, 200)
      const date = c.createdAt?.slice(0, 10) ?? "—"
      rows.push(`| \`${file}\` | ${line} | ${bodyTrim} | ${date} |`)
    }
    if (rows.length === 0) {
      return `_No unresolved comments from @${reviewerLogin} on #${prNumber}_`
    }
    const header = `| File | Line | Comment | Date |\n|------|------|---------|------|`
    return `Unresolved comments from @${reviewerLogin} on #${prNumber}:\n\n${header}\n${rows.join("\n")}`
  } catch (e: any) {
    return `_Failed to fetch threads: ${e?.message ?? "unknown error"}_`
  }
}

export async function fetchBranchRequiredReviews(
  owner: string,
  repo: string,
  branch: string,
): Promise<number | null> {
  try {
    const octokit = await getOctokit()
    const { data } = await octokit.repos.getBranchProtection({ owner, repo, branch })
    return data.required_pull_request_reviews?.required_approving_review_count ?? null
  } catch {
    return null
  }
}

export async function fetchOrgMembers(org: string): Promise<string[]> {
  try {
    const octokit = await getOctokit()
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
