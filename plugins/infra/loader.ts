// High-level data loaders for the PR dashboard.
//
// Backed by Octokit (REST + GraphQL), which gives us built-in throttling,
// retry, and timeouts — replacing the per-call `gh` spawn approach. The
// caller-facing shape of each function is unchanged.

import { getOctokit } from "./octokit"
import { currentBranch } from "./git"
import {
  PRFilter,
  type Repo,
  type ReviewerThreadCounts,
  type ReviewThread,
  type PR,
} from "../domain/types"
import { mapPullFromSearch, mapPullFromREST } from "./mappers"
import {
  DASHBOARD_QUERY,
  PR_LOOKUP_QUERY,
  BRANCH_RULES_QUERY,
  REVIEWER_THREADS_QUERY,
} from "./queries"

export type { PRFilter, Repo, ReviewerThreadCounts, PR }

// ─── Mappers ───

function extractThreadCounts(nodes: any[]): Map<number, ReviewerThreadCounts> {
  const out = new Map<number, ReviewerThreadCounts>()
  const normalize = (l: string) => l.replace(/\[bot\]$/, "")
  for (const n of nodes) {
    if (!n || !n.number) continue
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
  return out
}

// ─── Branch pattern matching ───

function matchesBranchPattern(pattern: string, branch: string): boolean {
  if (pattern === "*") return true
  if (pattern === branch) return true
  if (pattern.endsWith("/*")) {
    return branch.startsWith(pattern.slice(0, -1))
  }
  return false
}

function resolveBranchRule(
  branch: string,
  rules: { pattern: string; count: number | null }[],
): number | null {
  let best: { pattern: string; count: number | null } | null = null
  for (const r of rules) {
    if (matchesBranchPattern(r.pattern, branch)) {
      if (!best || r.pattern.length > best.pattern.length) {
        best = r
      }
    }
  }
  return best?.count ?? null
}

// ─── Loaders ───

// Wraps octokit.graphql to return partial data when some fields error.
// GitHub's GraphQL API returns both `data` and `errors` when specific
// fields are inaccessible (e.g. mergeStateStatus without admin scope).
// Octokit throws on any errors, but the partial data is still usable —
// errored fields are null in the response.
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
): Promise<{
  prs: PR[]
  threadCounts: Map<number, ReviewerThreadCounts>
  branchRules: Map<string, number | null>
}> {
  if (!repo) return { prs: [], threadCounts: new Map(), branchRules: new Map() }

  const qualifier = filter === PRFilter.Author ? "author:@me" : "assignee:@me"
  const q = `is:pr is:open repo:${repo.owner}/${repo.repo} ${qualifier} sort:updated-desc`

  const [prResult, branchRulesData] = await Promise.all([
    graphqlPartial(DASHBOARD_QUERY, { q }),
    fetchBranchProtectionRules(repo),
  ])

  const nodes: any[] = prResult?.search?.nodes ?? []
  const filtered = nodes.filter(Boolean)
  const prs = filtered.map(mapPullFromSearch)
  const threadCounts = extractThreadCounts(filtered)

  const uniqueBranches = Array.from(new Set(prs.map((p) => p.baseRefName)))
  const branchRules = new Map<string, number | null>()
  for (const branch of uniqueBranches) {
    branchRules.set(branch, resolveBranchRule(branch, branchRulesData))
  }

  return { prs, threadCounts, branchRules }
}

async function fetchBranchProtectionRules(
  repo: Repo,
): Promise<{ pattern: string; count: number | null }[]> {
  try {
    const octokit = getOctokit()
    const data: any = await octokit.graphql(BRANCH_RULES_QUERY, {
      owner: repo.owner,
      name: repo.repo,
    })
    return (data?.repository?.branchProtectionRules?.nodes ?? []).map((r: any) => ({
      pattern: r.pattern as string,
      count: r.requiredApprovingReviews as number | null,
    }))
  } catch {
    return []
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
  const q = `is:pr is:open repo:${repo.owner}/${repo.repo} head:${branch} sort:updated-desc`
  const data: any = await graphqlPartial(PR_LOOKUP_QUERY, { q })
  const nodes: any[] = data?.search?.nodes ?? []
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
