import { describe, expect, test } from "bun:test";
import { filterPRs } from "../../plugins/domain/pr-filters";
import { DashboardStatus } from "../../plugins/domain/types";
import { demoDashboardState, demoPageLoader } from "../../demo/fixtures";

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

  test("returns independent fixture arrays for each TUI instance", () => {
    const first = demoDashboardState();
    const second = demoDashboardState();
    first.prs[0].assigneeLogins.push("changed");

    expect(second.prs[0].assigneeLogins).not.toContain("changed");
  });

  test("pages filtered fixtures the way GitHub search would", async () => {
    const request = {
      repo: { owner: "acme", repo: "launchpad" },
      scope: "author" as const,
      statusFilter: "open" as const,
      currentBranch: "main",
      first: 5,
      after: null,
      requestTimeoutMs: 1000,
    };
    const first = await demoPageLoader(request);
    expect(first.prs).toHaveLength(5);
    expect(first.totalCount).toBeGreaterThan(5);
    expect(first.hasNextPage).toBe(true);

    const second = await demoPageLoader({ ...request, after: first.endCursor });
    expect(second.prs[0].number).not.toBe(first.prs[0].number);
    expect(5 + second.prs.length).toBe(first.totalCount);
  });
});
