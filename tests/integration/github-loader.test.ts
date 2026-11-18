import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
  mockOctokitOp,
} from "../helpers/octokit-mock";
import {
  MAX_REPOSITORY_PR_PAGES,
  currentBranchPR,
  currentBranchPRs,
  repositoryPRs,
  fetchOrgMembers,
  fetchOnePR,
} from "../../plugins/infra/loader";
import { makeFakeRepo } from "../helpers/graphql-mock";

installOctokitMock();

beforeEach(() => {
  clearOctokitMocks();
});

afterEach(() => {
  clearOctokitMocks();
});

describe("currentBranchPR", () => {
  test("returns the PR matching current branch", async () => {
    const dir = makeFakeRepo("foo", "bar");
    let lastQuery = "";
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        lastQuery = params?.query ?? "";
        return {
          repository: {
            pullRequests: {
              nodes: [
                {
                  number: 7,
                  title: "PR 7",
                  url: "https://github.com/foo/bar/pull/7",
                  isDraft: false,
                  state: "OPEN",
                  additions: 12,
                  deletions: 3,
                  baseRefName: "main",
                  mergeable: "MERGEABLE",
                  statusCheckRollup: {
                    state: "SUCCESS",
                    contexts: {
                      nodes: [
                        {
                          __typename: "CheckRun",
                          status: "COMPLETED",
                          conclusion: "SUCCESS",
                        },
                        { __typename: "StatusContext", state: "PENDING" },
                      ],
                    },
                  },
                  reviewThreads: {
                    nodes: [{ isResolved: false }, { isResolved: true }],
                  },
                  reviewRequests: { nodes: [] },
                  latestReviews: { nodes: [] },
                },
              ],
            },
          },
        };
      }
      return null;
    });
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir);
    expect(lastQuery).toContain("headRefName: $head");
    expect(lastQuery).toContain("states: [OPEN, CLOSED, MERGED]");
    expect(lastQuery).toContain("additions");
    expect(lastQuery).toContain("deletions");
    expect(lastQuery).toContain("contexts(first: 100)");
    expect(lastQuery).toContain("reviewThreads(first: 100)");
    expect(pr?.number).toBe(7);
    expect(pr?.checkStatuses).toEqual(["SUCCESS", "PENDING"]);
    expect(pr?.reviewThreads).toEqual([
      { isResolved: false },
      { isResolved: true },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null when no PR for branch", async () => {
    const dir = makeFakeRepo("foo", "bar");
    mockOctokitDefault((op) => {
      if (op === "graphql")
        return { repository: { pullRequests: { nodes: [] } } };
      return null;
    });
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir);
    expect(pr).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null when no .git/HEAD exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-dash-"));
    const pr = await currentBranchPR({ owner: "foo", repo: "bar" }, dir);
    expect(pr).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null when repo is null", async () => {
    const dir = makeFakeRepo("foo", "bar");
    const pr = await currentBranchPR(null, dir);
    expect(pr).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns open and merged PRs for the current branch", async () => {
    const dir = makeFakeRepo("foo", "bar");
    let lastParams: any;
    mockOctokitDefault((op, params) => {
      if (op === "graphql") {
        lastParams = params?.params;
        return {
          repository: {
            pullRequests: {
              nodes: [
                {
                  number: 8,
                  title: "Open",
                  state: "OPEN",
                  additions: 4,
                  deletions: 1,
                },
                {
                  number: 7,
                  title: "Merged",
                  state: "MERGED",
                  additions: 10,
                  deletions: 2,
                },
              ],
            },
          },
        };
      }
      return null;
    });
    const prs = await currentBranchPRs({ owner: "foo", repo: "bar" }, dir);
    expect(lastParams).toEqual({
      owner: "foo",
      name: "bar",
      head: "main",
      after: null,
    });
    expect(
      prs.map((pr) => [
        pr.number,
        pr.isMerged,
        pr.isClosed,
        pr.additions,
        pr.deletions,
      ]),
    ).toEqual([
      [8, false, false, 4, 1],
      [7, true, true, 10, 2],
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
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

describe("fetchOrgMembers", () => {
  test("extracts logins from listMembers response", async () => {
    mockOctokitDefault(() => ({
      data: [{ login: "alice" }, { login: "bob" }],
    }));
    const members = await fetchOrgMembers("acme");
    expect(members).toEqual(["alice", "bob"]);
  });

  test("returns empty array on error", async () => {
    mockOctokitDefault(() => {
      throw new Error("forbidden");
    });
    expect(await fetchOrgMembers("acme")).toEqual([]);
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
