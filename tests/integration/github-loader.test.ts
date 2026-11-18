import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
  mockOctokitOp,
} from "../helpers/octokit-mock";
import {
  MAX_REPOSITORY_PR_PAGES,
  repositoryPRs,
  fetchOnePR,
} from "../../plugins/infra/loader";

installOctokitMock();

beforeEach(() => {
  clearOctokitMocks();
});

afterEach(() => {
  clearOctokitMocks();
});

describe("repositoryPRs", () => {
  test("loads all available pages and maps viewer, author, assignee, branch, and state data", async () => {
    const paramsSeen: any[] = [];
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      const secondPage = params.params.after === "cursor-1";
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            pageInfo: secondPage
              ? { hasNextPage: false, endCursor: "cursor-2" }
              : { hasNextPage: true, endCursor: "cursor-1" },
            nodes: [
              {
                number: secondPage ? 2 : 1,
                title: secondPage ? "Closed PR" : "Open PR",
                state: secondPage ? "CLOSED" : "OPEN",
                headRefName: secondPage ? "fix" : "feature",
                author: { login: secondPage ? "alice" : "octocat" },
                assignees: {
                  nodes: [{ login: secondPage ? "octocat" : "bob" }],
                },
              },
            ],
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" });
    expect(paramsSeen).toEqual([
      { owner: "foo", name: "bar", head: null, after: null },
      { owner: "foo", name: "bar", head: null, after: "cursor-1" },
    ]);
    expect(result.viewerLogin).toBe("octocat");
    expect(result.listingTruncated).toBe(false);
    expect(result.fetchedPages).toBe(2);
    expect(
      result.prs.map((pr) => ({
        number: pr.number,
        isClosed: pr.isClosed,
        headRefName: pr.headRefName,
        authorLogin: pr.authorLogin,
        assigneeLogins: pr.assigneeLogins,
      })),
    ).toEqual([
      {
        number: 1,
        isClosed: false,
        headRefName: "feature",
        authorLogin: "octocat",
        assigneeLogins: ["bob"],
      },
      {
        number: 2,
        isClosed: true,
        headRefName: "fix",
        authorLogin: "alice",
        assigneeLogins: ["octocat"],
      },
    ]);
  });

  test("stops after three pages and reports that more PRs are available", async () => {
    const paramsSeen: any[] = [];
    let lastQuery = "";
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      lastQuery = params.query;
      const page = paramsSeen.length;
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: `cursor-${page}` },
            nodes: [{ number: page, title: `PR ${page}`, state: "OPEN" }],
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" });

    expect(MAX_REPOSITORY_PR_PAGES).toBe(3);
    expect(paramsSeen).toHaveLength(3);
    expect(paramsSeen.map(({ after }) => after)).toEqual([
      null,
      "cursor-1",
      "cursor-2",
    ]);
    expect(lastQuery).toContain("pullRequests(first: 100");
    expect(result.prs.map(({ number }) => number)).toEqual([1, 2, 3]);
    expect(result.fetchedPages).toBe(3);
    expect(result.listingTruncated).toBe(true);
  });

  test("honors a customized repository page limit", async () => {
    let calls = 0;
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      calls++;
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: `cursor-${calls}` },
            nodes: [{ number: calls, title: `PR ${calls}`, state: "OPEN" }],
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 2);

    expect(calls).toBe(2);
    expect(result.fetchedPages).toBe(2);
    expect(result.listingTruncated).toBe(true);
  });

  test("rejects an invalid or repeated pagination cursor", async () => {
    let calls = 0;
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      calls++;
      return {
        repository: {
          pullRequests: {
            pageInfo: {
              hasNextPage: true,
              endCursor: calls === 1 ? "cursor-1" : "cursor-1",
            },
            nodes: [],
          },
        },
      };
    });

    await expect(repositoryPRs({ owner: "foo", repo: "bar" })).rejects.toThrow(
      "invalid or repeated pull request pagination cursor",
    );
    expect(calls).toBe(2);
  });

  test("rejects a missing pagination cursor when more pages are advertised", async () => {
    mockOctokitDefault((op) =>
      op === "graphql"
        ? {
            repository: {
              pullRequests: {
                pageInfo: { hasNextPage: true, endCursor: null },
                nodes: [],
              },
            },
          }
        : null,
    );

    await expect(repositoryPRs({ owner: "foo", repo: "bar" })).rejects.toThrow(
      "invalid or repeated pull request pagination cursor",
    );
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
