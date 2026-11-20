import {
  DashboardStatus,
  type DashboardState,
  type PR,
} from "../plugins/domain/types";
import { filterPRs } from "../plugins/domain/pr-filters";

function demoPR(overrides: Partial<PR> & Pick<PR, "number" | "title">): PR {
  const { number, title, ...values } = overrides;
  return {
    number,
    title,
    url: `https://github.com/acme/launchpad/pull/${number}`,
    isDraft: false,
    isMerged: false,
    isClosed: values.isClosed ?? values.isMerged ?? false,
    headRefName: "feature/demo",
    authorLogin: "octocat",
    assigneeLogins: ["octocat"],
    additions: 64,
    deletions: 18,
    baseRefName: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    statusCheckRollup: { state: "SUCCESS" },
    checkStatuses: ["SUCCESS"],
    reviewThreads: [],
    reviewRequests: [],
    latestReviews: [],
    ...values,
  };
}

const demoPRs: PR[] = [
  demoPR({
    number: 248,
    title: "Add passkey sign-in",
    headRefName: "feature/passkeys",
    additions: 128,
    deletions: 36,
    reviewThreads: [{ isResolved: true }],
    latestReviews: [{ author: { login: "samantha" }, state: "APPROVED" }],
  }),
  demoPR({
    number: 247,
    title: "Retry expired sessions",
    additions: 86,
    deletions: 14,
    assigneeLogins: ["mia"],
    statusCheckRollup: { state: "FAILURE" },
    checkStatuses: ["SUCCESS", "FAILURE"],
    reviewRequests: [{ login: "alex" }],
    reviewThreads: [{ isResolved: false }, { isResolved: true }],
  }),
  demoPR({
    number: 246,
    title: "Add audit log filters",
    additions: 52,
    deletions: 21,
    headRefName: "feature/audit-filters",
    statusCheckRollup: { state: "PENDING" },
    checkStatuses: ["SUCCESS", "IN_PROGRESS"],
    latestReviews: [{ author: { login: "jules" }, state: "COMMENTED" }],
  }),
  demoPR({
    number: 245,
    title: "Improve keyboard navigation",
    additions: 41,
    deletions: 11,
    assigneeLogins: ["mia"],
    latestReviews: [{ author: { login: "samantha" }, state: "APPROVED" }],
  }),
  demoPR({
    number: 244,
    title: "Cache organization membership",
    additions: 23,
    deletions: 6,
    statusCheckRollup: { state: "PENDING" },
    checkStatuses: ["QUEUED"],
    reviewRequests: [{ login: "jules" }],
  }),
  demoPR({
    number: 243,
    title: "Add CLI configuration hints",
    additions: 31,
    deletions: 9,
    assigneeLogins: ["mia"],
  }),
  demoPR({
    number: 242,
    title: "Simplify session settings",
    additions: 17,
    deletions: 22,
    isDraft: true,
    mergeable: "CONFLICTING",
    statusCheckRollup: { state: "FAILURE" },
    checkStatuses: ["FAILURE"],
    assigneeLogins: ["octocat"],
  }),
  demoPR({
    number: 241,
    title: "Add workspace export",
    additions: 74,
    deletions: 13,
    headRefName: "feature/workspace-export",
    authorLogin: "octocat",
    assigneeLogins: ["samantha"],
    statusCheckRollup: { state: "PENDING" },
    checkStatuses: ["SUCCESS", "EXPECTED"],
  }),
  demoPR({
    number: 240,
    title: "Fix landing page contrast",
    additions: 12,
    deletions: 7,
    authorLogin: "mia",
    assigneeLogins: ["octocat"],
  }),
  demoPR({
    number: 239,
    title: "Prepare the v2.4 release",
    additions: 104,
    deletions: 28,
    isMerged: true,
    isClosed: true,
    latestReviews: [{ author: { login: "samantha" }, state: "APPROVED" }],
  }),
  demoPR({
    number: 238,
    title: "Remove legacy auth fallback",
    additions: 9,
    deletions: 33,
    authorLogin: "jules",
    assigneeLogins: ["octocat"],
    isClosed: true,
    mergeable: "CONFLICTING",
    statusCheckRollup: { state: "FAILURE" },
    checkStatuses: ["FAILURE"],
  }),
  demoPR({
    number: 237,
    title: "Streamline onboarding",
    additions: 65,
    deletions: 4,
    isMerged: true,
    isClosed: true,
    latestReviews: [{ author: { login: "mia" }, state: "APPROVED" }],
  }),
];

export function demoDashboardState(): DashboardState {
  return {
    status: DashboardStatus.Ok,
    repo: { owner: "acme", repo: "launchpad" },
    prs: demoPRs.map((pr) => ({
      ...pr,
      assigneeLogins: [...pr.assigneeLogins],
      checkStatuses: pr.checkStatuses ? [...pr.checkStatuses] : null,
      reviewThreads: pr.reviewThreads
        ? pr.reviewThreads.map((thread) => ({ ...thread }))
        : null,
      reviewRequests: pr.reviewRequests
        ? pr.reviewRequests.map((request) => ({ ...request }))
        : null,
      latestReviews: pr.latestReviews
        ? pr.latestReviews.map((review) => ({
            ...review,
            author: { ...review.author },
          }))
        : null,
    })),
    currentBranch: "feature/passkeys",
    viewerLogin: "octocat",
    fetchedAt: 0,
    pagination: {
      listing: "open",
      scope: "author",
      scopeValue: null,
      cursor: null,
      hasMore: false,
      totalCount: filterPRs(
        demoPRs,
        "author",
        "open",
        "feature/passkeys",
        "octocat",
      ).length,
      pagesLoaded: 1,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      loading: false,
      limitReached: false,
    },
  };
}
