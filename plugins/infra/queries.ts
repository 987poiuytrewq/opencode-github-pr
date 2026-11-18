// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code.

// PRs for a repository (or one head branch), including every GitHub state.
export const PULL_REQUESTS_QUERY = `query PullRequests($owner: String!, $name: String!, $head: String, $after: String) {
  viewer {
    login
  }
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $after, states: [OPEN, CLOSED, MERGED], headRefName: $head, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        number
        title
        url
        isDraft
        state
        headRefName
        author { login }
        assignees(first: 100) {
          nodes { login }
        }
        additions
        deletions
        baseRefName
        mergeable
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun {
                status
                conclusion
              }
              ... on StatusContext {
                state
              }
            }
          }
        }
        reviewThreads(first: 100) {
          nodes {
            isResolved
          }
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
