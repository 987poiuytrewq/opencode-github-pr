import {
  DashboardStatus,
  type DashboardState,
  type PR,
} from "../plugins/domain/types";
import { filterPRs } from "../plugins/domain/pr-filters";
import type { PRPageLoader } from "../plugins/app/usePRData";

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
    assigneeLogins: ["mia"],
    statusCheckRollup: { state: "FAILURE" },
    checkStatuses: ["SUCCESS", "FAILURE"],
    reviewRequests: [{ login: "alex" }],
    reviewThreads: [{ isResolved: false }, { isResolved: true }],
  }),
  demoPR({
    number: 246,
    title: "Add audit log filters",
    headRefName: "feature/audit-filters",
    statusCheckRollup: { state: "PENDING" },
    checkStatuses: ["SUCCESS", "IN_PROGRESS"],
    latestReviews: [{ author: { login: "jules" }, state: "COMMENTED" }],
  }),
  demoPR({
    number: 245,
    title: "Improve keyboard navigation",
    assigneeLogins: ["mia"],
    latestReviews: [{ author: { login: "samantha" }, state: "APPROVED" }],
  }),
  demoPR({
    number: 244,
    title: "Cache organization membership",
    statusCheckRollup: { state: "PENDING" },
    checkStatuses: ["QUEUED"],
    reviewRequests: [{ login: "jules" }],
  }),
  demoPR({
    number: 243,
    title: "Add CLI configuration hints",
    assigneeLogins: ["mia"],
    additions: 31,
    deletions: 9,
  }),
  demoPR({
    number: 242,
    title: "Simplify session settings",
    isDraft: true,
    mergeable: "CONFLICTING",
    statusCheckRollup: { state: "FAILURE" },
    checkStatuses: ["FAILURE"],
    assigneeLogins: ["octocat"],
  }),
  demoPR({
    number: 241,
    title: "Add workspace export",
    headRefName: "feature/workspace-export",
    authorLogin: "octocat",
    assigneeLogins: ["samantha"],
    statusCheckRollup: { state: "PENDING" },
    checkStatuses: ["SUCCESS", "EXPECTED"],
  }),
  demoPR({
    number: 240,
    title: "Fix landing page contrast",
    authorLogin: "mia",
    assigneeLogins: ["octocat"],
    additions: 12,
    deletions: 7,
  }),
  demoPR({
    number: 239,
    title: "Prepare the v2.4 release",
    isMerged: true,
    isClosed: true,
    latestReviews: [{ author: { login: "samantha" }, state: "APPROVED" }],
  }),
  demoPR({
    number: 238,
    title: "Remove legacy auth fallback",
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
    page: 0,
    totalCount: demoPRs.length,
    hasNextPage: false,
  };
}

// Serves the fixtures the way GitHub search would: filtered by scope and
// status, one page at a time, with the offset as the cursor.
export const demoPageLoader: PRPageLoader = async (request) => {
  const state = demoDashboardState();
  const matches = filterPRs(
    state.prs,
    request.scope,
    request.statusFilter,
    state.currentBranch,
    state.viewerLogin,
  );
  const offset = request.after ? Number(request.after) : 0;
  const end = offset + request.first;
  return {
    prs: matches.slice(offset, end),
    viewerLogin: state.viewerLogin,
    totalCount: matches.length,
    hasNextPage: end < matches.length,
    endCursor: end < matches.length ? String(end) : null,
  };
};
