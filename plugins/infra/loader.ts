// High-level data loaders for the PR dashboard.
//
// These functions wrap the raw `gh` CLI to fetch the data the TUI needs:
// the current repo, the list of open PRs, the current branch's PR,
// reviewer thread counts, branch protection rules, org membership, and
// the authenticated user. All return value shapes (Maps, nulls, parsed
// JSON) are owned by the loaders — callers stay focused on rendering.

import { spawn } from "../bun-utils"
import { runGh } from "./gh"
import type { Repo, ReviewerThreadCounts, TuiPR } from "../domain/types"

export type { Repo, ReviewerThreadCounts, TuiPR }

export const JSON_FIELDS = [
  "number",
  "title",
  "url",
  "isDraft",
  "author",
  "headRefName",
  "baseRefName",
  "reviewDecision",
  "mergeable",
  "mergeStateStatus",
  "createdAt",
  "updatedAt",
  "statusCheckRollup",
  "reviewRequests",
  "latestReviews",
].join(",")

export async function detectRepo(): Promise<Repo> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const proc = spawn({
        cmd: ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        stdout: "pipe",
        stderr: "pipe",
      })
      const text: string[] = []
      const err: string[] = []
      proc.stdout.pipeTo(new WritableStream({ write: (chunk) => (text.push(new TextDecoder().decode(chunk))) }))
      proc.stderr.pipeTo(new WritableStream({ write: (chunk) => (err.push(new TextDecoder().decode(chunk))) }))
      proc.exited.then((code) => {
        if (code === 0) resolve(text.join("").trim())
        else reject(new Error(err.join("").trim() || `gh exited ${code}`))
      })
    })
    const [owner, repo] = out.split("/")
    return owner && repo ? { owner, repo } : null
  } catch {
    return null
  }
}

export async function fetchPRs(): Promise<TuiPR[]> {
  return new Promise<TuiPR[]>((resolve, reject) => {
    const proc = spawn({
      cmd: [
        "gh",
        "pr",
        "list",
        "--state",
        "open",
        "--json",
        JSON_FIELDS,
        "--limit",
        "50",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const text: string[] = []
    const err: string[] = []
    proc.stdout.pipeTo(new WritableStream({ write: (chunk) => (text.push(new TextDecoder().decode(chunk))) }))
    proc.stderr.pipeTo(new WritableStream({ write: (chunk) => (err.push(new TextDecoder().decode(chunk))) }))
    proc.exited.then((code) => {
      if (code !== 0) {
        reject(new Error(err.join("").trim() || `gh pr list exited ${code}`))
        return
      }
      try {
        resolve(JSON.parse(text.join("")) as TuiPR[])
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export async function currentBranchPR(): Promise<TuiPR | null> {
  return new Promise<TuiPR | null>((resolve) => {
    const proc = spawn({
      cmd: ["gh", "pr", "view", "--json", JSON_FIELDS],
      stdout: "pipe",
      stderr: "pipe",
    })
    const text: string[] = []
    const err: string[] = []
    proc.stdout.pipeTo(new WritableStream({ write: (chunk) => (text.push(new TextDecoder().decode(chunk))) }))
    proc.stderr.pipeTo(new WritableStream({ write: (chunk) => (err.push(new TextDecoder().decode(chunk))) }))
    proc.exited.then((code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      try {
        const data = JSON.parse(text.join(""))
        if (data && typeof data.number === "number") resolve(data as TuiPR)
        else resolve(null)
      } catch {
        resolve(null)
      }
    })
  })
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
  const res = await runGh([
    "gh",
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${repo}`,
    "-f",
    `query=${THREAD_COUNT_QUERY}`,
  ])
  const out = new Map<number, ReviewerThreadCounts>()
  if (!res.ok) return out
  try {
    const data = JSON.parse(res.output)
    const nodes = data?.data?.repository?.pullRequests?.nodes ?? []
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
  const res = await runGh([
    "gh",
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${repo}`,
    "-F",
    `number=${prNumber}`,
    "-F",
    `query=${REVIEWER_THREADS_QUERY}`,
  ])
  if (!res.ok) return `_Failed to fetch threads: ${res.error ?? "unknown error"}_`
  try {
    const data = JSON.parse(res.output)
    const threads: any[] = data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
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
  } catch {
    return "_Failed to parse response_"
  }
}

export async function fetchBranchRequiredReviews(owner: string, repo: string, branch: string): Promise<number | null> {
  const res = await runGh([
    "gh",
    "api",
    `repos/${owner}/${repo}/branches/${branch}/protection/required_pull_request_reviews`,
  ])
  if (!res.ok) return null
  try {
    const data = JSON.parse(res.output)
    const n = data?.required_approving_reviewers_count
    return typeof n === "number" ? n : null
  } catch {
    return null
  }
}

export async function fetchOrgMembers(org: string): Promise<string[]> {
  const res = await runGh([
    "gh",
    "api",
    `orgs/${org}/members`,
    "--jq",
    ".[].login",
  ])
  if (!res.ok) return []
  return res.output
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function fetchCurrentUser(): Promise<string | null> {
  const res = await runGh(["gh", "api", "user", "--jq", ".login"])
  if (!res.ok) return null
  const login = res.output.trim()
  return login || null
}
