// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code. Each query is consumed by exactly one loader.

// PRs for the current branch, including open and merged PRs.
export const CURRENT_BRANCH_PRS_QUERY = `query CurrentBranchPRs($owner: String!, $name: String!, $head: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, states: [OPEN, MERGED], headRefName: $head, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        isDraft
        state
        additions
        deletions
        baseRefName
        mergeable
        statusCheckRollup {
          state
        }
        reviewThreads(first: 100) {
          nodes {
            isResolved
          }
        }
        reviewRequests(first: 5) {
          nodes {
            requestedReviewer {
              ... on User { login }
            }
          }
        }
        latestReviews(first: 5) {
          nodes {
            author { login }
            state
          }
        }
      }
    }
  }
}`

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
