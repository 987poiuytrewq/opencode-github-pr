// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code.

// One page of PRs matching a GitHub search query (see prSearchQuery). The
// search runs server-side, so only the rows the sidebar shows are fetched.
export const SEARCH_PULL_REQUESTS_QUERY = `query SearchPullRequests($query: String!, $first: Int!, $after: String) {
  viewer {
    login
  }
  search(query: $query, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ... on PullRequest {
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
