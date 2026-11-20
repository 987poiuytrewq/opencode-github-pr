import { describe, expect, test } from "bun:test";
import { filterPRs } from "../../plugins/domain/pr-filters";
import { reviewStatusGroups } from "../../plugins/domain/pr-status";
import { DashboardStatus } from "../../plugins/domain/types";
import { demoDashboardState } from "../../demo/fixtures";

describe("dashboard demo data", () => {
  test("has enough authored open PRs to demonstrate pagination", () => {
    const state = demoDashboardState();
    const authoredOpen = filterPRs(
      state.prs,
      "author",
      "open",
      state.currentBranch,
      state.viewerLogin,
    );

    expect(state.status).toBe(DashboardStatus.Ok);
    expect(authoredOpen.length).toBeGreaterThan(5);
    expect(state.pagination.totalCount).toBe(authoredOpen.length);
    expect(
      authoredOpen.some((pr) => pr.headRefName === state.currentBranch),
    ).toBe(true);
  });

  test("includes closed and mixed-author PRs for filter demonstrations", () => {
    const state = demoDashboardState();
    const closed = filterPRs(
      state.prs,
      "all",
      "closed",
      state.currentBranch,
      state.viewerLogin,
    );
    const all = filterPRs(
      state.prs,
      "all",
      "all",
      state.currentBranch,
      state.viewerLogin,
    );

    expect(closed.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(state.prs.length - 1);
    expect(new Set(all.map((pr) => pr.authorLogin)).size).toBeGreaterThan(1);
  });

  test("uses distinct additions and deletions counts for each PR", () => {
    const { prs } = demoDashboardState();

    expect(new Set(prs.map((pr) => pr.additions)).size).toBe(prs.length);
    expect(new Set(prs.map((pr) => pr.deletions)).size).toBe(prs.length);
  });

  test("shows merge readiness, review decisions, and mixed review requests", () => {
    const { prs } = demoDashboardState();
    const mergeStates = new Set(prs.map((pr) => pr.mergeStateStatus));
    const reviewDecisions = new Set(prs.map((pr) => pr.reviewDecision));
    const requestTypes = new Set(
      prs.flatMap((pr) =>
        (pr.reviewRequests ?? []).map((request) => request.type),
      ),
    );
    const requestedReviewerCounts = prs
      .map((pr) => pr.reviewRequests?.length ?? 0)
      .filter((count) => count > 0);

    expect(mergeStates).toContain("HAS_HOOKS");
    expect(mergeStates).toContain("BLOCKED");
    expect(mergeStates).toContain("BEHIND");
    expect(mergeStates).toContain("UNSTABLE");
    expect(reviewDecisions).toContain("CHANGES_REQUESTED");
    expect(reviewDecisions).toContain("REVIEW_REQUIRED");
    expect(requestTypes).toEqual(new Set(["user", "team"]));
    expect(new Set(requestedReviewerCounts).size).toBeGreaterThan(1);
    expect(prs.some((pr) => reviewStatusGroups(pr).length > 1)).toBe(true);
  });

  test("returns independent fixture arrays for each TUI instance", () => {
    const first = demoDashboardState();
    const second = demoDashboardState();
    first.prs[0].assigneeLogins.push("changed");

    expect(second.prs[0].assigneeLogins).not.toContain("changed");
  });
});
