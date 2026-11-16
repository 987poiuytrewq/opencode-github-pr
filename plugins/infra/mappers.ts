// PR shape mappers: convert raw Octokit responses (GraphQL search nodes and
// REST pull objects) into the shared PR domain type. Both mappers live
// here so that changes to PR only need to be reflected in one place.

import type { PR } from "../domain/types"

// Maps a GraphQL PullRequest node to PR.  Author/assignee are attached
// as private fields for client-side filtering by fetchDashboardData.
export function mapPullFromSearch(p: any): PR {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    isDraft: p.isDraft ?? false,
    baseRefName: p.baseRefName,
    mergeable: (p.mergeable ?? "UNKNOWN").toUpperCase(),
    statusCheckRollup: p.statusCheckRollup ?? null,
    reviewRequests: (p.reviewRequests?.nodes ?? [])
      .map((n: any) => n.requestedReviewer?.login)
      .filter(Boolean)
      .map((login: string) => ({ login })),
    latestReviews: (p.latestReviews?.nodes ?? []).map((r: any) => ({
      author: { login: r.author?.login ?? "" },
      state: r.state,
    })),
    _authorLogin: p.author?.login ?? "",
    _assigneeLogins: (p.assignees?.nodes ?? []).map((a: any) => a.login),
  }
}

// Maps a REST `pulls.get` response data object to PR.  REST doesn't
// provide statusCheckRollup, so the field is null.
export function mapPullFromREST(p: any): PR {
  return {
    number: p.number,
    title: p.title,
    url: p.html_url,
    isDraft: p.draft ?? false,
    baseRefName: p.base.ref,
    mergeable: p.mergeable ? "MERGEABLE" : p.mergeable === false ? "CONFLICTING" : "UNKNOWN",
    statusCheckRollup: null,
    reviewRequests: (p.requested_reviewers ?? []).map((r: any) => ({ login: r.login })),
    latestReviews: (p.latest_reviews ?? []).map((r: any) => ({
      author: { login: r.user?.login ?? "" },
      state: r.state,
    })),
  }
}
