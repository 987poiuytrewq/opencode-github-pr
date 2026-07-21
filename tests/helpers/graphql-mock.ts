// Shared fixtures for GraphQL/REST mock responses used by integration tests.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Create a temp directory with a .git/config pointing at
// github.com/{owner}/{repo}.git. Used by tests that need detectRepo() to
// resolve a repo from the filesystem.
export function makeFakeRepo(owner = "owner", repo = "repo"): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-dash-test-"))
  const gitDir = join(dir, ".git")
  mkdirSync(gitDir)
  writeFileSync(
    join(gitDir, "config"),
    `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = https://github.com/${owner}/${repo}.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`,
  )
  writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n")
  return dir
}

// GraphQL search response with N fake PRs. Matches the shape produced by
// DASHBOARD_QUERY / PR_LOOKUP_QUERY.
export function makeSearchResponse(prCount = 2) {
  return {
    search: {
      nodes: Array.from({ length: prCount }, (_, i) => ({
        number: i + 1,
        title: `Test PR #${i + 1}`,
        url: `https://github.com/owner/repo/pull/${i + 1}`,
        isDraft: false,
        baseRefName: "main",
        mergeable: "MERGEABLE",
        statusCheckRollup: { state: "SUCCESS" },
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [] },
      })),
    },
  }
}

// Empty GraphQL fallback for non-search queries (e.g. REVIEWER_THREADS_QUERY).
export function makeThreadCountResponse() {
  return { data: { repository: { pullRequests: { nodes: [] } } } }
}

// Empty REST response fallback (e.g. for branch protection queries).
export function makeBranchProtectionResponse() {
  return { data: {} }
}
