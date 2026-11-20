// Maps raw GitHub GraphQL pull requests into the shared PR domain type.

import type { PR } from "../domain/types"

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue {
  return typeof value === "object" && value !== null ? value as RecordValue : {}
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

// Maps a GraphQL PullRequest node to PR.
export function mapPullFromGraphQL(value: unknown): PR {
  const p = record(value)
  const author = record(p.author)
  const assignees = record(p.assignees)
  const rollup = p.statusCheckRollup == null ? null : record(p.statusCheckRollup)
  const contexts = rollup ? record(rollup.contexts) : {}
  const contextNodes = array(contexts.nodes)
  const contextTotalCount = number(contexts.totalCount, contextNodes.length)
  const reviewThreads = record(p.reviewThreads)
  const reviewThreadNodes = array(reviewThreads.nodes)
  const reviewThreadTotalCount = number(reviewThreads.totalCount, reviewThreadNodes.length)
  const reviewRequests = record(p.reviewRequests)
  const latestReviews = record(p.latestReviews)
  return {
    number: number(p.number),
    title: string(p.title),
    url: string(p.url),
    isDraft: p.isDraft === true,
    isMerged: p.state === "MERGED" || p.merged === true,
    isClosed: p.state === "CLOSED" || p.state === "MERGED" || p.merged === true,
    headRefName: string(p.headRefName),
    headRepositoryOwnerLogin: string(record(p.headRepositoryOwner).login),
    authorLogin: string(author.login),
    assigneeLogins: array(assignees.nodes)
      .map((assignee) => string(record(assignee).login))
      .filter(Boolean),
    additions: number(p.additions),
    deletions: number(p.deletions),
    baseRefName: string(p.baseRefName),
    mergeable: string(p.mergeable, "UNKNOWN").toUpperCase(),
    mergeStateStatus: string(p.mergeStateStatus, "UNKNOWN").toUpperCase(),
    reviewDecision: p.reviewDecision === null
      ? null
      : string(p.reviewDecision, "UNKNOWN").toUpperCase(),
    statusCheckRollup: rollup ? { state: string(rollup.state, "UNKNOWN") } : null,
    // The rollup still captures aggregate CI state when contexts are
    // truncated, without pretending the first 100 are all of it.
    checkStatuses: contextTotalCount > contextNodes.length
      ? null
      : Array.isArray(contexts.nodes)
      ? contextNodes
          .map((value) => {
            const context = record(value)
            return context.__typename === "CheckRun"
              ? string(context.conclusion) || string(context.status)
              : string(context.state)
          })
          .filter(Boolean)
      : null,
    reviewThreads: Array.isArray(reviewThreads.nodes)
      ? reviewThreadNodes.map((thread) => ({ isResolved: record(thread).isResolved === true }))
      : null,
    reviewThreadsTruncated: reviewThreadTotalCount > reviewThreadNodes.length,
    reviewRequests: array(reviewRequests.nodes)
      .map((node) => record(record(node).requestedReviewer))
      .flatMap<NonNullable<PR["reviewRequests"]>[number]>((reviewer) => {
        const login = string(reviewer.login)
        if (login) return [{ type: "user" as const, login }]
        const slug = string(reviewer.slug)
        return slug ? [{ type: "team" as const, slug }] : []
      }),
    latestReviews: array(latestReviews.nodes).map((value) => {
      const review = record(value)
      return {
        author: { login: string(record(review.author).login) },
        state: string(review.state),
      }
    }),
  }
}
