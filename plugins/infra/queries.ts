// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code.

// PRs for a repository (or one head branch) in the given GitHub states.
export const PULL_REQUESTS_QUERY = `query PullRequests($owner: String!, $name: String!, $states: [PullRequestState!]!, $head: String, $after: String) {
  viewer {
    login
  }
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $after, states: $states, headRefName: $head, orderBy: {field: UPDATED_AT, direction: DESC}) {
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
