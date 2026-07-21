// PR shape mappers: convert raw Octokit responses (GraphQL search nodes and
// REST pull objects) into the shared PR domain type. Both mappers live
// here so that changes to PR only need to be reflected in one place.

import type { PR } from "../domain/types"

// Maps a GraphQL `search.nodes` PullRequest object to PR. Used by
// fetchDashboardData and currentBranchPR.
export function mapPullFromSearch(p: any): PR {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    isDraft: p.isDraft ?? false,
    author: p.author ? { login: p.author.login } : null,
    headRefName: p.headRefName,
    baseRefName: p.baseRefName,
    reviewDecision: p.reviewDecision ?? null,
    mergeable: (p.mergeable ?? "UNKNOWN").toUpperCase(),
    mergeStateStatus: (p.mergeStateStatus ?? null)?.toUpperCase() ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    statusCheckRollup: p.statusCheckRollup ? [{ state: p.statusCheckRollup.state }] : null,
    reviewRequests: (p.reviewRequests?.nodes ?? [])
      .map((n: any) => n.requestedReviewer?.login)
      .filter(Boolean)
      .map((login: string) => ({ login })),
    latestReviews: (p.latestReviews?.nodes ?? []).map((r: any) => ({
      author: { login: r.author?.login ?? "" },
      state: r.state,
      createdAt: r.createdAt ?? "",
    })),
    assignees: (p.assignees?.nodes ?? []).map((a: any) => ({ login: a.login })),
  }
}

// Maps a REST `pulls.get` response data object to PR. Used by fetchOnePR
// to refresh a single PR after a reviewer is added.
export function mapPullFromREST(p: any): PR {
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
    reviewRequests: (p.requested_reviewers ?? []).map((r: any) => ({ login: r.login })),
    latestReviews: (p.latest_reviews ?? []).map((r: any) => ({
      author: { login: r.user?.login ?? "" },
      state: r.state,
      createdAt: r.submitted_at ?? "",
    })),
    assignees: (p.assignees ?? []).map((a: any) => ({ login: a.login })),
  }
}
