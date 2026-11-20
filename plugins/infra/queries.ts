// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code.

const PULL_REQUEST_FIELDS = `fragment DashboardPullRequestFields on PullRequest {
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
}`

// PRs for a repository (or one head branch) in the given GitHub states.
export const PULL_REQUESTS_QUERY = `query PullRequests($owner: String!, $name: String!, $states: [PullRequestState!]!, $head: String, $after: String, $first: Int!) {
  viewer {
    login
  }
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, after: $after, states: $states, headRefName: $head, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes { ...DashboardPullRequestFields }
    }
  }
}
${PULL_REQUEST_FIELDS}`

// GitHub doesn't expose author or assignee filters on Repository.pullRequests,
// so those scope filters use issue search, which supports both qualifiers.
export const PULL_REQUESTS_SEARCH_QUERY = `query SearchPullRequests($searchQuery: String!, $after: String, $first: Int!) {
  viewer {
    login
  }
  search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ... on PullRequest {
        ...DashboardPullRequestFields
      }
    }
  }
}
${PULL_REQUEST_FIELDS}`
