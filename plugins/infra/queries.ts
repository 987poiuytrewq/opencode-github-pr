// GraphQL query strings used by the PR dashboard loaders.
//
// Kept separate from loader.ts so the query surface is easy to audit
// (scope requirements, field selection) without scrolling through the
// orchestration code.

const PULL_REQUEST_FIELDS_BASE = `fragment DashboardPullRequestFields on PullRequest {
  number
  title
  url
  isDraft
  state
  headRefName
  headRepositoryOwner { login }
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
      totalCount
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
    totalCount
    nodes {
      isResolved
    }
  }
  reviewRequests(first: 100) {
    nodes {
      requestedReviewer {
        ... on User { login }
        ... on Team { slug }
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

const PULL_REQUEST_STATUS_FIELDS = `  mergeStateStatus
  reviewDecision`

const withPullRequestStatusFields = (fragment: string) =>
  fragment.replace("  statusCheckRollup {", `${PULL_REQUEST_STATUS_FIELDS}\n  statusCheckRollup {`)

const PULL_REQUEST_FIELDS = withPullRequestStatusFields(PULL_REQUEST_FIELDS_BASE)

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

// Older GHES versions may not expose these two fields. The loader retries
// once with this status-field-free query only when GraphQL reports them unknown.
export const PULL_REQUESTS_QUERY_LEGACY = `query PullRequests($owner: String!, $name: String!, $states: [PullRequestState!]!, $head: String, $after: String, $first: Int!) {
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
${PULL_REQUEST_FIELDS_BASE}`

// GitHub doesn't expose author or assignee filters on Repository.pullRequests,
// so those scopes use issue search. A small recent PR connection supplements
// search while its index catches up.
export const PULL_REQUESTS_SEARCH_QUERY = `query SearchPullRequests($owner: String!, $name: String!, $states: [PullRequestState!]!, $searchQuery: String!, $after: String, $first: Int!, $recentPRsLimit: Int!, $includeRecentPRs: Boolean!) {
  viewer {
    login
  }
  repository(owner: $owner, name: $name) {
    recentPullRequests: pullRequests(first: $recentPRsLimit, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) @include(if: $includeRecentPRs) {
      nodes { ...DashboardPullRequestFields }
    }
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

export const PULL_REQUESTS_SEARCH_QUERY_LEGACY = `query SearchPullRequests($owner: String!, $name: String!, $states: [PullRequestState!]!, $searchQuery: String!, $after: String, $first: Int!, $recentPRsLimit: Int!, $includeRecentPRs: Boolean!) {
  viewer {
    login
  }
  repository(owner: $owner, name: $name) {
    recentPullRequests: pullRequests(first: $recentPRsLimit, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) @include(if: $includeRecentPRs) {
      nodes { ...DashboardPullRequestFields }
    }
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
${PULL_REQUEST_FIELDS_BASE}`
