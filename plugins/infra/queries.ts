// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code. Each query is consumed by exactly one loader.

// PR list for the dashboard.  Uses repository.pullRequests instead of
// the search API because the search API requires additional scopes
// (Checks: Read / Commit Statuses: Read) to read statusCheckRollup.
// The direct connection works with basic repo scope.  Author/assignee
// filtering is done client-side in fetchDashboardData.
export const DASHBOARD_QUERY = `query Dashboard($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        isDraft
        baseRefName
        mergeable
        author { login }
        assignees(first: 10) { nodes { login } }
        statusCheckRollup {
          state
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

// Single-PR lookup by branch.  Uses repository.pullRequests with headRefName filter.
export const PR_LOOKUP_QUERY = `query Lookup($owner: String!, $name: String!, $head: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 1, states: OPEN, headRefName: $head) {
      nodes {
        number
        title
        url
        isDraft
        baseRefName
        mergeable
        statusCheckRollup {
          state
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

// Get the authenticated viewer's login.  Used for client-side author/assignee
// filtering after switching away from the search API.
export const VIEWER_QUERY = `query Viewer {
  viewer { login }
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
