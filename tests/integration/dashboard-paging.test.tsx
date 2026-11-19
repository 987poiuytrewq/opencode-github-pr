/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { makeFakeRepo } from "../helpers/graphql-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"
import { createDashboard } from "../helpers/dashboard-fixture"
import { makeTUIPR } from "../helpers/tui-fixtures"
import type { DashboardFilters, PRPageLoader, PRPageRequest } from "../../plugins/app/usePRData"
import { DashboardStatus } from "../../plugins/domain/types"

// A loader over `total` PRs that uses the offset as the cursor.
function fakeLoader(total: number, requests: PRPageRequest[]): PRPageLoader {
  return async (request) => {
    requests.push(request)
    const offset = request.after ? Number(request.after) : 0
    const end = Math.min(total, offset + request.first)
    return {
      prs: Array.from({ length: end - offset }, (_, i) => makeTUIPR({ number: offset + i + 1 })),
      viewerLogin: "octocat",
      totalCount: total,
      hasNextPage: end < total,
      endCursor: end < total ? String(end) : null,
    }
  }
}

async function inRepo<T>(fn: () => Promise<T>): Promise<T> {
  const origCwd = process.cwd()
  process.chdir(makeFakeRepo())
  try {
    return await fn()
  } finally {
    process.chdir(origCwd)
  }
}

describe("useDashboard paging", () => {
  test("loads one page at a time and follows cursors forwards and back", () =>
    inRepo(async () => {
      const requests: PRPageRequest[] = []
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, { pageSize: 5, loadPage: fakeLoader(12, requests) })
      await refresh()

      expect(state().prs.map((pr) => pr.number)).toEqual([1, 2, 3, 4, 5])
      expect(state().totalCount).toBe(12)
      expect(state().hasNextPage).toBe(true)
      expect(requests.every((request) => request.first === 5)).toBe(true)

      await refresh(1)
      expect(state().page).toBe(1)
      expect(state().prs.map((pr) => pr.number)).toEqual([6, 7, 8, 9, 10])
      expect(requests.at(-1)?.after).toBe("5")

      await refresh(2)
      expect(state().prs.map((pr) => pr.number)).toEqual([11, 12])
      expect(state().hasNextPage).toBe(false)

      await refresh(1)
      expect(requests.at(-1)?.after).toBe("5")
      expect(state().page).toBe(1)

      // A background reload keeps the current page.
      await refresh()
      expect(requests.at(-1)?.after).toBe("5")
      expect(state().page).toBe(1)
    }))

  test("passes the filters to the loader and starts again from the first page when they change", () =>
    inRepo(async () => {
      const requests: PRPageRequest[] = []
      let filters: DashboardFilters = { scope: "author", statusFilter: "open" }
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, {
        pageSize: 5,
        filters: () => filters,
        loadPage: fakeLoader(12, requests),
      })
      await refresh()
      await refresh(1)
      expect(requests.at(-1)).toMatchObject({ scope: "author", statusFilter: "open", currentBranch: "main" })

      filters = { scope: "all", statusFilter: "closed" }
      // The cursor for page 1 belongs to the old filters, so it isn't reused.
      await refresh(1)
      expect(requests.at(-1)).toMatchObject({ scope: "all", statusFilter: "closed", after: null })
      expect(state().page).toBe(0)
    }))

  test("falls back to the first page when a later page comes back empty", () =>
    inRepo(async () => {
      let total = 12
      const requests: PRPageRequest[] = []
      const loader = fakeLoader(12, requests)
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, {
        pageSize: 5,
        loadPage: async (request) => {
          const page = await loader(request)
          return request.after && Number(request.after) >= total ? { ...page, prs: [] } : page
        },
      })
      await refresh()
      await refresh(1)
      await refresh(2)
      total = 6
      await refresh()

      expect(state().status).toBe(DashboardStatus.Ok)
      expect(state().page).toBe(0)
      expect(requests.at(-1)?.after).toBeNull()
    }))

  test("a newer page request wins over one still in flight", () =>
    inRepo(async () => {
      const requests: PRPageRequest[] = []
      const loader = fakeLoader(20, requests)
      const { api } = createMockTuiApi()
      const { state, refresh } = createDashboard(api, {
        pageSize: 5,
        loadPage: async (request) => {
          const page = await loader(request)
          // Make page 1 slower than page 2.
          if (request.after === "5") await new Promise((resolve) => setTimeout(resolve, 30))
          return page
        },
      })
      await refresh()
      await refresh(1)
      await refresh(2)
      await refresh(0)

      const slow = refresh(1)
      const fast = refresh(0)
      await Promise.all([slow, fast])

      expect(state().page).toBe(0)
      expect(state().prs[0].number).toBe(1)
    }))
})
