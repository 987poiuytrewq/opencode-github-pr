import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
} from "../helpers/octokit-mock";
import {
  DEFAULT_PR_BATCH_SIZE,
  repositoryPRs,
} from "../../plugins/infra/loader";
import * as loader from "../../plugins/infra/loader";
import * as mappers from "../../plugins/infra/mappers";
import {
  createOctokit,
  getOctokit,
  setOctokit,
} from "../../plugins/infra/octokit";

installOctokitMock();

beforeEach(() => {
  clearOctokitMocks();
});

afterEach(() => {
  clearOctokitMocks();
});

describe("repositoryPRs", () => {
  test("does not expose the unused REST fetcher or mapper", () => {
    expect("fetchOnePR" in loader).toBe(false);
    expect("mapPullFromREST" in mappers).toBe(false);
  });

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
            totalCount: 2,
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

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 3);
    expect(paramsSeen).toEqual([
      {
        owner: "foo",
        name: "bar",
        states: ["OPEN"],
        head: null,
        after: null,
        first: 3,
      },
      {
        owner: "foo",
        name: "bar",
        states: ["OPEN"],
        head: null,
        after: "cursor-1",
        first: 2,
      },
    ]);
    expect(result.viewerLogin).toBe("octocat");
    expect(result.totalCount).toBe(2);
    expect(result.hasMore).toBe(false);
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

  test("filters branch-scope fork PRs and decrements totalCount for each fetched batch", async () => {
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      const secondPage = params.params.after === "cursor-1";
      return {
        repository: {
          pullRequests: {
            totalCount: 3,
            pageInfo: {
              hasNextPage: true,
              endCursor: secondPage ? "cursor-2" : "cursor-1",
            },
            nodes: [
              {
                number: secondPage ? 2 : 1,
                title: "Branch PR",
                state: "OPEN",
                headRefName: "feature",
                headRepositoryOwner: {
                  login: secondPage ? "upstream" : "personal",
                },
                author: { login: "octocat" },
              },
            ],
          },
        },
      };
    });

    const firstBatch = await repositoryPRs(
      { owner: "upstream", repo: "repo" },
      1,
      15_000,
      "open",
      null,
      "branch",
      "feature",
      0,
      5,
      "personal",
    );
    expect(firstBatch.prs.map((pr) => pr.number)).toEqual([1]);
    expect(firstBatch.totalCount).toBe(3);
    expect(firstBatch.filteredPRCount).toBe(0);

    const secondBatch = await repositoryPRs(
      { owner: "upstream", repo: "repo" },
      1,
      15_000,
      "open",
      firstBatch.endCursor,
      "branch",
      "feature",
      0,
      5,
      "personal",
    );
    expect(secondBatch.prs).toEqual([]);
    expect(secondBatch.totalCount).toBe(2);
    expect(secondBatch.filteredPRCount).toBe(1);
    expect(
      Math.max(0, (firstBatch.totalCount ?? 0) - secondBatch.filteredPRCount),
    ).toBe(2);

    const unfiltered = await repositoryPRs(
      { owner: "upstream", repo: "repo" },
      1,
      15_000,
      "open",
      null,
      "branch",
      "feature",
      0,
      5,
      null,
    );
    expect(unfiltered.prs.map((pr) => pr.number)).toEqual([1]);
    expect(unfiltered.totalCount).toBe(3);
    expect(unfiltered.filteredPRCount).toBe(0);
  });

  test("loads the default four-PR batch and reports that more PRs are available", async () => {
    let calls = 0;
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      calls++;
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            totalCount: 11,
            pageInfo: { hasNextPage: true, endCursor: `cursor-${calls}` },
            nodes: [{ number: calls, title: `PR ${calls}`, state: "OPEN" }],
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" });

    expect(DEFAULT_PR_BATCH_SIZE).toBe(4);
    expect(calls).toBe(4);
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBe(11);
    expect(result.endCursor).toBe("cursor-4");
  });

  test("requests exactly the requested PR batch size when it fits in one GitHub request", async () => {
    let captured: any = null;
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      captured = params;
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: "cursor-20" },
            nodes: Array.from({ length: params.params.first }, (_, i) => ({
              number: i + 1,
              title: `PR ${i + 1}`,
              state: "OPEN",
            })),
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 20);

    expect(captured.params.first).toBe(20);
    expect(result.prs).toHaveLength(20);
    expect(result.fetchedPages).toBe(1);
  });

  test("splits a PR batch larger than 100 across GitHub requests", async () => {
    const firsts: number[] = [];
    let offset = 0;
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      const first = params.params.first;
      firsts.push(first);
      const start = offset + 1;
      offset += first;
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            pageInfo: {
              hasNextPage: offset < 120,
              endCursor: `cursor-${offset}`,
            },
            nodes: Array.from({ length: first }, (_, i) => ({
              number: start + i,
              title: `PR ${start + i}`,
              state: "OPEN",
            })),
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 120);

    expect(firsts).toEqual([100, 20]);
    expect(result.prs).toHaveLength(120);
    expect(result.fetchedPages).toBe(2);
  });

  test("bounds a large PR batch to the requested records across 100-item pages", async () => {
    const firsts: number[] = [];
    let offset = 0;
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      const first = params.params.first;
      firsts.push(first);
      const start = offset + 1;
      offset += first;
      return {
        repository: {
          pullRequests: {
            pageInfo: {
              hasNextPage: true,
              endCursor: `cursor-${offset}`,
            },
            nodes: Array.from({ length: first }, (_, i) => ({
              number: start + i,
              title: `PR ${start + i}`,
              state: "OPEN",
            })),
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 250);

    expect(firsts).toEqual([100, 100, 50]);
    expect(result.prs).toHaveLength(250);
    expect(result.fetchedPages).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  test("requests closed and merged PRs for the closed listing", async () => {
    const paramsSeen: any[] = [];
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      return {
        repository: {
          pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
        },
      };
    });

    await repositoryPRs({ owner: "foo", repo: "bar" }, 1, 15_000, "closed");

    expect(paramsSeen.map(({ states }) => states)).toEqual([
      ["CLOSED", "MERGED"],
    ]);
  });

  test("requests all pull request states for the all listing", async () => {
    const paramsSeen: any[] = [];
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      return {
        repository: {
          pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
        },
      };
    });

    await repositoryPRs({ owner: "foo", repo: "bar" }, 1, 15_000, "all");

    expect(paramsSeen.map(({ states }) => states)).toEqual([
      ["OPEN", "CLOSED", "MERGED"],
    ]);
  });

  test("uses GitHub search for the author scope and includes the status filter", async () => {
    let captured: any = null;
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      captured = params;
      return {
        viewer: { login: "octocat" },
        search: {
          issueCount: 7,
          pageInfo: { hasNextPage: false, endCursor: "search-cursor-1" },
          nodes: [
            {
              number: 7,
              title: "Authored PR",
              state: "CLOSED",
              author: { login: "octocat" },
            },
          ],
        },
      };
    });

    const result = await repositoryPRs(
      { owner: "foo", repo: "bar" },
      4,
      15_000,
      "closed",
      null,
      "author",
    );

    expect(captured.query).toContain("search(query: $searchQuery");
    expect(captured.query).toContain("issueCount");
    expect(captured.params.searchQuery).toContain(
      "repo:foo/bar is:pr author:@me is:closed",
    );
    expect(captured.params).toMatchObject({
      recentPRsLimit: 5,
      includeRecentPRs: true,
    });
    expect(result.prs.map(({ number }) => number)).toEqual([7]);
    expect(result.viewerLogin).toBe("octocat");
    expect(result.totalCount).toBe(7);
  });

  test("supplements author search with recent matching PRs missing from the index", async () => {
    let captured: any = null;
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      captured = params;
      return {
        viewer: { login: "octocat" },
        repository: {
          recentPullRequests: {
            nodes: [
              {
                number: 9,
                title: "Recent authored PR",
                state: "OPEN",
                author: { login: "octocat" },
              },
              {
                number: 8,
                title: "Someone else's PR",
                state: "OPEN",
                author: { login: "alice" },
              },
              {
                number: 7,
                title: "Already indexed",
                state: "OPEN",
                author: { login: "octocat" },
              },
            ],
          },
        },
        search: {
          issueCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              number: 7,
              title: "Already indexed",
              state: "OPEN",
              author: { login: "octocat" },
            },
          ],
        },
      };
    });

    const result = await repositoryPRs(
      { owner: "foo", repo: "bar" },
      4,
      15_000,
      "open",
      null,
      "author",
      null,
      0,
      3,
    );

    expect(captured.params).toMatchObject({
      owner: "foo",
      name: "bar",
      states: ["OPEN"],
      recentPRsLimit: 3,
      includeRecentPRs: true,
    });
    expect(captured.query).toContain("field: CREATED_AT, direction: DESC");
    expect(result.prs.map(({ number }) => number)).toEqual([9, 7]);
    expect(result.totalCount).toBe(2);
    expect(result.searchResultsFetched).toBe(1);
    expect(result.supplementalPRCount).toBe(1);
  });

  test("supplements assignee search only with recent PRs assigned to the viewer", async () => {
    mockOctokitDefault((op) =>
      op === "graphql"
        ? {
            viewer: { login: "octocat" },
            repository: {
              recentPullRequests: {
                nodes: [
                  {
                    number: 11,
                    title: "Assigned recent PR",
                    state: "OPEN",
                    assignees: { nodes: [{ login: "OctoCat" }] },
                  },
                  {
                    number: 12,
                    title: "Unassigned to viewer",
                    state: "OPEN",
                    assignees: { nodes: [{ login: "alice" }] },
                  },
                ],
              },
            },
            search: {
              issueCount: 0,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [],
            },
          }
        : null,
    );

    const result = await repositoryPRs(
      { owner: "foo", repo: "bar" },
      4,
      15_000,
      "open",
      null,
      "assignee",
    );

    expect(result.prs.map(({ number }) => number)).toEqual([11]);
    expect(result.totalCount).toBe(1);
    expect(result.supplementalPRCount).toBe(1);
  });

  test("does not request recent PRs when disabled or while continuing search pagination", async () => {
    const paramsSeen: any[] = [];
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      return {
        viewer: { login: "octocat" },
        search: {
          issueCount: 10,
          pageInfo: { hasNextPage: false, endCursor: "next" },
          nodes: [
            { number: paramsSeen.length, title: "Indexed PR", state: "OPEN" },
          ],
        },
      };
    });

    await repositoryPRs(
      { owner: "foo", repo: "bar" },
      1,
      15_000,
      "open",
      null,
      "author",
      null,
      0,
      0,
    );
    await repositoryPRs(
      { owner: "foo", repo: "bar" },
      1,
      15_000,
      "open",
      "cursor-1",
      "author",
      null,
      1,
      5,
    );

    expect(paramsSeen.map(({ includeRecentPRs }) => includeRecentPRs)).toEqual([
      false,
      false,
    ]);
  });

  test("uses the pull-request connection head filter for the branch scope", async () => {
    let captured: any = null;
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      captured = params;
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                number: 8,
                title: "Branch PR",
                state: "OPEN",
                headRefName: "feature/x",
                headRepositoryOwner: { login: "foo" },
              },
              {
                number: 9,
                title: "Fork PR with same branch",
                state: "OPEN",
                headRefName: "feature/x",
                headRepositoryOwner: { login: "contributor" },
              },
            ],
          },
        },
      };
    });

    const result = await repositoryPRs(
      { owner: "foo", repo: "bar" },
      4,
      15_000,
      "open",
      null,
      "branch",
      "feature/x",
    );

    expect(captured.params).toMatchObject({
      states: ["OPEN"],
      head: "feature/x",
    });
    expect(captured.query).toContain("headRefName: $head");
    expect(result.prs.map(({ number }) => number)).toEqual([8]);
  });

  test("invalidates a cached client after a 401 so the next refresh creates a fresh client", async () => {
    const previousToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-refresh-token";
    const staleClient = {
      graphql: async () => {
        throw Object.assign(new Error("Unauthorized"), { status: 401 });
      },
    } as any;
    setOctokit(staleClient);

    try {
      await expect(
        repositoryPRs({ owner: "foo", repo: "bar" }, 1),
      ).rejects.toThrow("Unauthorized");
      const refreshedClient = await getOctokit();
      expect(refreshedClient).not.toBe(staleClient);
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousToken;
    }
  });

  test("uses rollup state for truncated contexts and marks truncated review counts", async () => {
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      return {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                number: 11,
                title: "Many checks and reviews",
                state: "OPEN",
                statusCheckRollup: {
                  state: "SUCCESS",
                  contexts: {
                    totalCount: 101,
                    nodes: Array.from({ length: 100 }, () => ({
                      __typename: "CheckRun",
                      conclusion: "SUCCESS",
                    })),
                  },
                },
                reviewThreads: {
                  totalCount: 101,
                  nodes: Array.from({ length: 100 }, () => ({
                    isResolved: false,
                  })),
                },
              },
            ],
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 1);
    expect(result.prs[0]).toMatchObject({
      checkStatuses: null,
      statusCheckRollup: { state: "SUCCESS" },
      reviewThreadsTruncated: true,
    });
    expect(result.prs[0].reviewThreads).toHaveLength(100);
  });

  test("stops search-backed listings at GitHub's 1,000-result limit", async () => {
    let calls = 0;
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      calls++;
      const first = params.params.first;
      const start = calls === 1 ? 999 : 1000;
      return {
        viewer: { login: "octocat" },
        search: {
          pageInfo: {
            hasNextPage: true,
            endCursor: `search-cursor-${start + first - 1}`,
          },
          nodes: Array.from({ length: first }, (_, i) => ({
            number: start + i,
            title: `PR ${start + i}`,
            state: "OPEN",
          })),
        },
      };
    });

    const result = await repositoryPRs(
      { owner: "foo", repo: "bar" },
      4,
      15_000,
      "all",
      "search-cursor-998",
      "assignee",
      null,
      998,
    );

    expect(calls).toBe(1);
    expect(result.fetchedPages).toBe(1);
    expect(result.prs).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.limitReached).toBe(true);
  });

  test("continues from the supplied cursor without refetching the first page", async () => {
    const paramsSeen: any[] = [];
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      paramsSeen.push(params.params);
      return {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: "cursor-5" },
            nodes: [{ number: 5, title: "PR 5", state: "OPEN" }],
          },
        },
      };
    });

    const result = await repositoryPRs(
      { owner: "foo", repo: "bar" },
      4,
      15_000,
      "open",
      "cursor-4",
    );

    expect(paramsSeen.map(({ after }) => after)).toEqual(["cursor-4"]);
    expect(result.prs.map(({ number }) => number)).toEqual([5]);
    expect(result.endCursor).toBe("cursor-5");
  });

  test("stops after the batch count and reports that more PRs are available", async () => {
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

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 3);

    expect(paramsSeen).toHaveLength(3);
    expect(paramsSeen.map(({ after }) => after)).toEqual([
      null,
      "cursor-1",
      "cursor-2",
    ]);
    expect(lastQuery).toContain("totalCount");
    expect(lastQuery).toContain("pullRequests(first: $first");
    expect(result.prs.map(({ number }) => number)).toEqual([1, 2, 3]);
    expect(result.fetchedPages).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  test("honors a customized PR batch size", async () => {
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
    expect(result.hasMore).toBe(true);
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

    await expect(
      repositoryPRs({ owner: "foo", repo: "bar" }, 3),
    ).rejects.toThrow("invalid or repeated pull request pagination cursor");
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

  test("propagates a pagination request failure instead of returning a partial listing", async () => {
    let calls = 0;
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      calls++;
      if (calls === 2) throw new Error("GitHub request failed");
      return {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            nodes: [{ number: 1, title: "PR 1", state: "OPEN" }],
          },
        },
      };
    });

    await expect(
      repositoryPRs({ owner: "foo", repo: "bar" }, 2),
    ).rejects.toThrow("GitHub request failed");
    expect(calls).toBe(2);
  });

  test("keeps usable search results when the optional recent-PR connection errors", async () => {
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      const error = Object.assign(new Error("Recent PRs are not accessible"), {
        data: {
          viewer: { login: "octocat" },
          repository: { recentPullRequests: null },
          search: {
            issueCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 7,
                title: "Search result",
                state: "OPEN",
                author: { login: "octocat" },
              },
            ],
          },
        },
        errors: [
          {
            type: "NOT_FOUND",
            path: ["repository", "recentPullRequests"],
            message: "Recent pull requests are unavailable",
          },
        ],
      });
      throw error;
    });

    const result = await repositoryPRs(
      { owner: "foo", repo: "bar" },
      10,
      15_000,
      "open",
      null,
      "author",
    );
    expect(result.prs.map((pr) => pr.number)).toEqual([7]);
    expect(result.totalCount).toBe(1);
  });

  test("keeps required search-connection errors fatal", async () => {
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      throw Object.assign(new Error("Search is unavailable"), {
        data: {
          viewer: { login: "octocat" },
          repository: { recentPullRequests: { nodes: [] } },
          search: null,
        },
        errors: [
          {
            type: "NOT_FOUND",
            path: ["search"],
            message: "Search is unavailable",
          },
        ],
      });
    });

    await expect(
      repositoryPRs(
        { owner: "foo", repo: "bar" },
        10,
        15_000,
        "open",
        null,
        "author",
      ),
    ).rejects.toThrow("Search is unavailable");
  });

  test("keeps required repository listing errors fatal", async () => {
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      throw Object.assign(new Error("Pull request listing is unavailable"), {
        data: {
          viewer: { login: "octocat" },
          repository: { pullRequests: null },
        },
        errors: [
          {
            type: "FORBIDDEN",
            path: ["repository", "pullRequests"],
            message: "Pull request listing is unavailable",
          },
        ],
      });
    });

    await expect(
      repositoryPRs({ owner: "foo", repo: "bar" }, 1),
    ).rejects.toThrow("Pull request listing is unavailable");
  });

  test("retries once without unsupported status fields on older GHES", async () => {
    const queries: string[] = [];
    mockOctokitDefault((op, params) => {
      if (op !== "graphql") return null;
      queries.push(params.query);
      if (queries.length === 1) {
        throw Object.assign(new Error("Validation failed"), {
          status: 422,
          errors: [
            {
              message:
                "Field 'mergeStateStatus' doesn't exist on type 'PullRequest'",
            },
            {
              message:
                "Cannot query field 'reviewDecision' on type 'PullRequest'",
            },
          ],
        });
      }
      const secondPage = params.params.after === "cursor-1";
      return {
        viewer: { login: "octocat" },
        repository: {
          pullRequests: {
            totalCount: 2,
            pageInfo: secondPage
              ? { hasNextPage: false, endCursor: null }
              : { hasNextPage: true, endCursor: "cursor-1" },
            nodes: [
              {
                number: secondPage ? 4 : 3,
                title: secondPage ? "Second GHES PR" : "GHES PR",
                state: "OPEN",
              },
            ],
          },
        },
      };
    });

    const result = await repositoryPRs({ owner: "foo", repo: "bar" }, 2);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain("mergeStateStatus");
    expect(queries[1]).not.toContain("mergeStateStatus");
    expect(queries[1]).not.toContain("reviewDecision");
    expect(queries[2]).not.toContain("mergeStateStatus");
    expect(result.prs.map((pr) => pr.number)).toEqual([3, 4]);
    expect(result.prs[0]?.mergeStateStatus).toBe("UNKNOWN");
  });

  test("does not retry unrelated GraphQL 422 errors", async () => {
    let calls = 0;
    mockOctokitDefault((op) => {
      if (op !== "graphql") return null;
      calls++;
      throw Object.assign(new Error("Validation failed"), {
        status: 422,
        errors: [
          { message: "Unknown argument 'headRefName' on field 'pullRequests'" },
        ],
      });
    });

    await expect(
      repositoryPRs({ owner: "foo", repo: "bar" }, 1),
    ).rejects.toThrow("Validation failed");
    expect(calls).toBe(1);
  });

  test("surfaces a secondary rate limit without advancing pagination", async () => {
    let calls = 0;
    const fetchWithRateLimit: typeof fetch = Object.assign(
      async () => {
        calls++;
        return new Response(
          JSON.stringify({
            message: "You have exceeded a secondary rate limit. Please wait.",
            documentation_url:
              "https://docs.github.com/rest/overview/resources-in-the-rest-api#secondary-rate-limits",
          }),
          {
            status: 403,
            headers: {
              "content-type": "application/json",
              "retry-after": "0",
            },
          },
        );
      },
      { preconnect: () => {} },
    );
    setOctokit(
      createOctokit({ token: "test-token", fetch: fetchWithRateLimit }),
    );

    await expect(
      repositoryPRs({ owner: "foo", repo: "bar" }, 2),
    ).rejects.toThrow("secondary rate limit");
    expect(calls).toBe(1);
  });
});
