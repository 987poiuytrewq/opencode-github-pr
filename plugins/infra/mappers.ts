// PR shape mappers: convert raw GitHub GraphQL and REST pull objects into
// the shared PR domain type. Both mappers live
// here so that changes to PR only need to be reflected in one place.

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
  const reviewThreads = record(p.reviewThreads)
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
    authorLogin: string(author.login),
    assigneeLogins: array(assignees.nodes)
      .map((assignee) => string(record(assignee).login))
      .filter(Boolean),
    additions: number(p.additions),
    deletions: number(p.deletions),
    baseRefName: string(p.baseRefName),
    mergeable: string(p.mergeable, "UNKNOWN").toUpperCase(),
    statusCheckRollup: rollup ? { state: string(rollup.state, "UNKNOWN") } : null,
    checkStatuses: Array.isArray(contexts.nodes)
      ? contexts.nodes
          .map((value) => {
            const context = record(value)
            return context.__typename === "CheckRun"
              ? string(context.conclusion) || string(context.status)
              : string(context.state)
          })
          .filter(Boolean)
      : null,
    reviewThreads: Array.isArray(reviewThreads.nodes)
      ? reviewThreads.nodes.map((thread) => ({ isResolved: record(thread).isResolved === true }))
      : null,
    reviewRequests: array(reviewRequests.nodes)
      .map((node) => string(record(record(node).requestedReviewer).login))
      .filter(Boolean)
      .map((login) => ({ login })),
    latestReviews: array(latestReviews.nodes).map((value) => {
      const review = record(value)
      return {
        author: { login: string(record(review.author).login) },
        state: string(review.state),
      }
    }),
  }
}

// Maps a REST `pulls.get` response data object to PR.  REST doesn't
// provide statusCheckRollup, so the field is null.
export function mapPullFromREST(value: unknown): PR {
  const p = record(value)
  const head = record(p.head)
  const base = record(p.base)
  const user = record(p.user)
  return {
    number: number(p.number),
    title: string(p.title),
    url: string(p.html_url),
    isDraft: p.draft === true,
    isMerged: p.merged === true,
    isClosed: p.state === "closed" || p.merged === true,
    headRefName: string(head.ref),
    authorLogin: string(user.login),
    assigneeLogins: array(p.assignees)
      .map((assignee) => string(record(assignee).login))
      .filter(Boolean),
    additions: number(p.additions),
    deletions: number(p.deletions),
    baseRefName: string(base.ref),
    mergeable: p.mergeable === true ? "MERGEABLE" : p.mergeable === false ? "CONFLICTING" : "UNKNOWN",
    statusCheckRollup: null,
    checkStatuses: null,
    reviewThreads: null,
    reviewRequests: array(p.requested_reviewers)
      .map((reviewer) => string(record(reviewer).login))
      .filter(Boolean)
      .map((login) => ({ login })),
    latestReviews: array(p.latest_reviews).map((value) => {
      const review = record(value)
      return {
        author: { login: string(record(review.user).login) },
        state: string(review.state),
      }
    }),
  }
}
