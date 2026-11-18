// PR shape mappers: convert raw GitHub GraphQL and REST pull objects into
// the shared PR domain type. Both mappers live
// here so that changes to PR only need to be reflected in one place.

import type { PR } from "../domain/types"

// Maps a GraphQL PullRequest node to PR.
export function mapPullFromGraphQL(p: any): PR {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    isDraft: p.isDraft ?? false,
    isMerged: p.state === "MERGED" || p.merged === true,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    baseRefName: p.baseRefName,
    mergeable: (p.mergeable ?? "UNKNOWN").toUpperCase(),
    statusCheckRollup: p.statusCheckRollup ?? null,
    reviewThreads: p.reviewThreads?.nodes?.map((thread: any) => ({
      isResolved: thread.isResolved ?? false,
    })) ?? null,
    reviewRequests: (p.reviewRequests?.nodes ?? [])
      .map((n: any) => n.requestedReviewer?.login)
      .filter(Boolean)
      .map((login: string) => ({ login })),
    latestReviews: (p.latestReviews?.nodes ?? []).map((r: any) => ({
      author: { login: r.author?.login ?? "" },
      state: r.state,
    })),
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
    isMerged: p.merged ?? false,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    baseRefName: p.base.ref,
    mergeable: p.mergeable ? "MERGEABLE" : p.mergeable === false ? "CONFLICTING" : "UNKNOWN",
    statusCheckRollup: null,
    reviewThreads: null,
    reviewRequests: (p.requested_reviewers ?? []).map((r: any) => ({ login: r.login })),
    latestReviews: (p.latest_reviews ?? []).map((r: any) => ({
      author: { login: r.user?.login ?? "" },
      state: r.state,
    })),
  }
}
