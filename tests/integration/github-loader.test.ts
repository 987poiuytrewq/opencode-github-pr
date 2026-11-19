import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
  mockOctokitOp,
} from "../helpers/octokit-mock";
import { searchPRs, fetchOnePR } from "../../plugins/infra/loader";

installOctokitMock();

beforeEach(() => {
  clearOctokitMocks();
});

afterEach(() => {
  clearOctokitMocks();
});

describe("searchPRs", () => {
  test("requests one page of search results and maps viewer, total, cursor, and PR data", async () => {
    const paramsSeen: any[] = [];
    let querySeen = "";
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      querySeen = params.query;
      return {
        viewer: { login: "octocat" },
        search: {
          issueCount: 42,
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          nodes: [
            {
              number: 1,
              title: "Open PR",
              state: "OPEN",
              headRefName: "feature",
              author: { login: "octocat" },
              assignees: { nodes: [{ login: "bob" }] },
            },
            {
              number: 2,
              title: "Merged PR",
              state: "MERGED",
              headRefName: "fix",
              author: { login: "alice" },
              assignees: { nodes: [] },
            },
          ],
        },
      };
    });

    const result = await searchPRs("repo:foo/bar is:pr", 5, null);

    expect(paramsSeen).toEqual([
      { query: "repo:foo/bar is:pr", first: 5, after: null },
    ]);
    expect(querySeen).toContain(
      "search(query: $query, type: ISSUE, first: $first, after: $after)",
    );
    expect(result.viewerLogin).toBe("octocat");
    expect(result.totalCount).toBe(42);
    expect(result.hasNextPage).toBe(true);
    expect(result.endCursor).toBe("cursor-1");
    expect(
      result.prs.map((pr) => ({
        number: pr.number,
        isClosed: pr.isClosed,
        isMerged: pr.isMerged,
        headRefName: pr.headRefName,
        authorLogin: pr.authorLogin,
        assigneeLogins: pr.assigneeLogins,
      })),
    ).toEqual([
      {
        number: 1,
        isClosed: false,
        isMerged: false,
        headRefName: "feature",
        authorLogin: "octocat",
        assigneeLogins: ["bob"],
      },
      {
        number: 2,
        isClosed: true,
        isMerged: true,
        headRefName: "fix",
        authorLogin: "alice",
        assigneeLogins: [],
      },
    ]);
  });

  test("passes the cursor for later pages", async () => {
    const paramsSeen: any[] = [];
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      return {
        search: {
          issueCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      };
    });

    const result = await searchPRs("repo:foo/bar is:pr", 10, "cursor-3");

    expect(paramsSeen).toEqual([
      { query: "repo:foo/bar is:pr", first: 10, after: "cursor-3" },
    ]);
    expect(result.hasNextPage).toBe(false);
    expect(result.endCursor).toBeNull();
  });

  test("skips search results that aren't pull requests", async () => {
    mockOctokitDefault((op) =>
      op === "graphql"
        ? {
            search: {
              issueCount: 2,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{}, null, { number: 7, title: "PR", state: "OPEN" }],
            },
          }
        : null,
    );

    const result = await searchPRs("repo:foo/bar is:pr", 5, null);

    expect(result.prs.map(({ number }) => number)).toEqual([7]);
  });
});

describe("fetchOnePR", () => {
  test("maps REST pulls.get response to PR", async () => {
    const restPR = {
      number: 42,
      title: "REST PR",
      html_url: "https://github.com/foo/bar/pull/42",
      draft: false,
      user: { login: "alice" },
      head: { ref: "feature" },
      base: { ref: "main" },
      review_decision: "APPROVED",
      mergeable: true,
      merged: false,
      additions: 9,
      deletions: 2,
      mergeable_state: "clean",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
      status_check_rollup: null,
      requested_reviewers: [{ login: "bob" }],
      latest_reviews: [],
      assignees: [],
    };
    let captured: any = null;
    mockOctokitOp("pulls.get", (params) => {
      captured = params;
      return { data: restPR };
    });
    const pr = await fetchOnePR({ owner: "foo", repo: "bar" }, 42);
    expect(captured).toMatchObject({
      owner: "foo",
      repo: "bar",
      pull_number: 42,
    });
    expect(pr.number).toBe(42);
    expect(pr.title).toBe("REST PR");
    expect(pr.url).toBe("https://github.com/foo/bar/pull/42");
    expect(pr.baseRefName).toBe("main");
    expect(pr.mergeable).toBe("MERGEABLE");
    expect(pr.isMerged).toBe(false);
    expect(pr.headRefName).toBe("feature");
    expect(pr.authorLogin).toBe("alice");
    expect(pr.assigneeLogins).toEqual([]);
    expect(pr.additions).toBe(9);
    expect(pr.deletions).toBe(2);
    expect(pr.reviewRequests).toEqual([{ login: "bob" }]);
  });

  test("maps mergeable=false to CONFLICTING", async () => {
    mockOctokitOp("pulls.get", () => ({
      data: {
        number: 1,
        title: "x",
        html_url: "u",
        draft: false,
        user: { login: "a" },
        head: { ref: "f" },
        base: { ref: "m" },
        mergeable: false,
        mergeable_state: "dirty",
        created_at: "x",
        updated_at: "x",
      },
    }));
    const pr = await fetchOnePR({ owner: "foo", repo: "bar" }, 1);
    expect(pr.mergeable).toBe("CONFLICTING");
  });
});
