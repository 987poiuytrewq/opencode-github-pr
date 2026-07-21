// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code. Each query is consumed by exactly one loader.

export const DASHBOARD_QUERY = `query Dashboard($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        author { login }
        headRefName
        baseRefName
        reviewDecision
        mergeable
        mergeStateStatus
        statusCheckRollup { state }
        createdAt
        updatedAt
        reviewRequests(first: 10) {
          nodes {
            requestedReviewer {
              ... on User { login }
            }
          }
        }
        latestReviews(first: 10) {
          nodes {
            author { login }
            state
            createdAt
          }
        }
        assignees(first: 10) {
          nodes { login }
        }
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 20) {
              nodes {
                author { login }
              }
            }
          }
        }
      }
    }
  }
}`

export const PR_LOOKUP_QUERY = `query Lookup($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        author { login }
        headRefName
        baseRefName
        reviewDecision
        mergeable
        mergeStateStatus
        statusCheckRollup { state }
        createdAt
        updatedAt
        reviewRequests(first: 10) {
          nodes {
            requestedReviewer {
              ... on User { login }
            }
          }
        }
        latestReviews(first: 10) {
          nodes {
            author { login }
            state
            createdAt
          }
        }
        assignees(first: 10) {
          nodes { login }
        }
      }
    }
  }
}`

// Branch protection rules in a single call — replaces N per-branch REST
// calls.  Wrapped in try/catch by the caller since it requires admin
// access to the repository.
export const BRANCH_RULES_QUERY = `query BranchRules($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    branchProtectionRules(first: 100) {
      nodes {
        pattern
        requiredApprovingReviews
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
