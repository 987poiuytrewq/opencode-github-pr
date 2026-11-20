import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitDefault,
  mockOctokitOp,
} from "../helpers/octokit-mock";
import {
  DEFAULT_PR_BATCH_SIZE,
  repositoryPRs,
  fetchOnePR,
} from "../../plugins/infra/loader";
import { createOctokit, setOctokit } from "../../plugins/infra/octokit";

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
