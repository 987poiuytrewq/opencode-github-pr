import { describe, expect, test } from "bun:test"
import { filterPRs, nextPRScope, nextPRStatusFilter, prSearchQuery } from "../../plugins/domain/pr-filters"
import type { PRScope, PRStatusFilter } from "../../plugins/domain/types"
import { makeTUIPR } from "../helpers/tui-fixtures"

const prs = [
  makeTUIPR({ number: 1, headRefName: "feature", authorLogin: "octocat", assigneeLogins: ["alice"] }),
  makeTUIPR({ number: 2, headRefName: "other", authorLogin: "alice", assigneeLogins: ["octocat"] }),
  makeTUIPR({
    number: 3,
    headRefName: "other",
    authorLogin: "alice",
    assigneeLogins: [],
    isMerged: true,
    isClosed: true,
  }),
]

describe("PR filter cycling", () => {
  test("cycles scopes in the requested order", () => {
    let scope: PRScope = "branch"
    const values: PRScope[] = [scope]
    for (let i = 0; i < 4; i++) {
      scope = nextPRScope(scope)
      values.push(scope)
    }
    expect(values).toEqual(["branch", "author", "assignee", "all", "branch"])
  })

  test("cycles statuses in the requested order", () => {
    let status: PRStatusFilter = "open"
    const values: PRStatusFilter[] = [status]
    for (let i = 0; i < 3; i++) {
      status = nextPRStatusFilter(status)
      values.push(status)
    }
    expect(values).toEqual(["open", "closed", "all", "open"])
  })
})

describe("filterPRs", () => {
  test("filters by current branch and open state", () => {
    expect(filterPRs(prs, "branch", "open", "feature", "octocat").map((pr) => pr.number)).toEqual([1])
  })

  test("filters author and assignee case-insensitively", () => {
    expect(filterPRs(prs, "author", "all", "feature", "OCTOCAT").map((pr) => pr.number)).toEqual([1])
    expect(filterPRs(prs, "assignee", "all", "feature", "OCTOCAT").map((pr) => pr.number)).toEqual([2])
  })

  test("all scope includes all repository PRs and closed includes merged PRs", () => {
    expect(filterPRs(prs, "all", "closed", null, null).map((pr) => pr.number)).toEqual([3])
    expect(filterPRs(prs, "all", "all", null, null).map((pr) => pr.number)).toEqual([1, 2, 3])
  })

  test("user scopes return no matches without an authenticated login", () => {
    expect(filterPRs(prs, "author", "all", "feature", null)).toEqual([])
    expect(filterPRs(prs, "assignee", "all", "feature", null)).toEqual([])
  })
})

describe("prSearchQuery", () => {
  const repo = { owner: "acme", repo: "app" }

  test("builds a qualifier for each scope", () => {
    expect(prSearchQuery(repo, "author", "open", "main")).toBe("repo:acme/app is:pr author:@me is:open sort:updated-desc")
    expect(prSearchQuery(repo, "assignee", "open", "main")).toBe("repo:acme/app is:pr assignee:@me is:open sort:updated-desc")
    expect(prSearchQuery(repo, "branch", "open", "feature/x")).toBe("repo:acme/app is:pr head:feature/x is:open sort:updated-desc")
    expect(prSearchQuery(repo, "all", "open", "main")).toBe("repo:acme/app is:pr is:open sort:updated-desc")
  })

  test("builds a qualifier for each status", () => {
    expect(prSearchQuery(repo, "all", "closed", null)).toBe("repo:acme/app is:pr is:closed sort:updated-desc")
    expect(prSearchQuery(repo, "all", "all", null)).toBe("repo:acme/app is:pr sort:updated-desc")
  })

  test("quotes branch names that contain quotes", () => {
    expect(prSearchQuery(repo, "branch", "all", 'say-"hi"')).toBe('repo:acme/app is:pr head:"say-\\"hi\\"" sort:updated-desc')
  })

  test("skips the search when the branch scope has no current branch", () => {
    expect(prSearchQuery(repo, "branch", "open", null)).toBeNull()
  })
})
