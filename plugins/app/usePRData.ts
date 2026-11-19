// Data-fetching logic for the PR dashboard.
//
// Reactive signals (createSignal, onCleanup, etc.) must NOT be imported
// here. This is a .ts file, and Bun's @opentui/solid plugin only rewrites
// solid-js imports to the reactive build for .tsx/.jsx files. Importing
// createSignal in a .ts file silently gets the SSR (non-reactive) build,
// which causes state updates to never propagate to the view.
//
// All signals are created in the entry .tsx file and passed in.
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import {
  DashboardStatus,
  type DashboardState,
  type PRScope,
  type PRSearchPage,
  type PRStatusFilter,
  type Repo,
} from "../domain/types"
import { currentBranch, detectRepo } from "../infra/git"
import { searchPRs, fetchOnePR } from "../infra/loader"
import { prSearchQuery } from "../domain/pr-filters"
import { prListErrorKind, prListErrorMessage, parseRateLimitError } from "../domain/messages"
import { DEFAULT_PAGE_SIZE, DEFAULT_REQUEST_TIMEOUT_MS } from "./config"

export type DashboardFilters = { scope: PRScope; statusFilter: PRStatusFilter }

export type PRPageRequest = DashboardFilters & {
  repo: Repo
  currentBranch: string | null
  first: number
  // endCursor of the previous page, or null for the first page.
  after: string | null
  requestTimeoutMs: number
}

// Loads one page of PRs. The default asks GitHub search to do the filtering;
// demo mode swaps in a loader over local fixtures.
export type PRPageLoader = (request: PRPageRequest) => Promise<PRSearchPage>

const emptyPage: PRSearchPage = { prs: [], viewerLogin: null, totalCount: 0, hasNextPage: false, endCursor: null }

export const githubPageLoader: PRPageLoader = async (request) => {
  const query = prSearchQuery(request.repo, request.scope, request.statusFilter, request.currentBranch)
  if (!query) return emptyPage
  return searchPRs(query, request.first, request.after, request.requestTimeoutMs)
}

export type DashboardLoaderOptions = {
  filters?: () => DashboardFilters
  pageSize?: number
  requestTimeoutMs?: number
  loadPage?: PRPageLoader
}

export function useDashboard(
  api: TuiPluginContext,
  state: () => DashboardState,
  setState: (fn: (s: DashboardState) => DashboardState) => void,
  options: DashboardLoaderOptions = {},
): {
  refresh: (page?: number) => Promise<void>
  refreshOne: (n: number) => Promise<void>
} {
  const filters = options.filters ?? (() => ({ scope: "author", statusFilter: "open" }))
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const loadPage = options.loadPage ?? githubPageLoader

  // Resolve the working directory explicitly when the TUI exposes it, so
  // repo detection doesn't depend on where opencode happens to launch.
  // Falls back to process.cwd() for tests that chdir() into a temp repo.
  const cwd = async (): Promise<string> => {
    const route = api.ui.router.current()
    if (route.type === "session") {
      let session = api.data.session.get(route.sessionID)
      if (!session) {
        try {
          session = await api.client.session.get({ sessionID: route.sessionID })
        } catch {
          // Fall back to the current TUI location if the session is unavailable.
        }
      }
      const directory = session?.location.directory
      if (directory) return directory
    }
    return api.location?.directory ?? api.data.location.default().directory ?? process.cwd()
  }

  let inFlight: Promise<void> | null = null
  let inFlightKey = ""
  let refreshToken = 0
  let currentRefreshToken = 0
  // GitHub search pages by cursor, so remember the cursor that starts each
  // page of the current list. cursors[n] starts page n; page 0 has none.
  let cursorsKey = ""
  let cursors: Array<string | null> = [null]

  // Load `page` of the PR list for the current filters. Without a page,
  // reload the page that is showing.
  const refresh = async (page?: number) => {
    const prev = state()
    const { scope, statusFilter } = filters()
    const requestedPage = Math.max(0, Math.floor(page ?? prev.page))
    const requestKey = `${scope}|${statusFilter}|${requestedPage}`
    // A background reload (no page) never interrupts a load in progress; a
    // new page or filter replaces it, and the older result is discarded.
    if (inFlight && (page === undefined || inFlightKey === requestKey)) return inFlight
    const token = ++refreshToken
    const release = () => {
      if (inFlight && currentRefreshToken === token) inFlight = null
    }
    const promise = (async () => {
      const isStale = () => token !== refreshToken
      try {
        const directory = await cwd()
        const repo = detectRepo(directory)
        if (!repo) {
          if (isStale()) return
          setState((s) => ({
            ...s,
            status: DashboardStatus.NoRepo,
            repo: null,
            prs: [],
            currentBranch: null,
            viewerLogin: null,
            page: 0,
            totalCount: 0,
            hasNextPage: false,
            error: undefined,
            errorKind: undefined,
            fetchedAt: Date.now(),
          }))
          return
        }
        const branch = currentBranch(directory)
        const listKey = [repo.owner, repo.repo, scope, statusFilter, branch ?? "", pageSize].join("|")
        const isNewList = listKey !== cursorsKey
        const pageCursors = isNewList ? [null] : [...cursors]
        // Pages are reached one step at a time; if the cursor for a page
        // isn't known (the list changed), start again from the first page.
        let targetPage = pageCursors[requestedPage] !== undefined ? requestedPage : 0

        const isFirstLoad = prev.fetchedAt === null
        const showLoading = isFirstLoad || isNewList || targetPage !== prev.page || prev.status === DashboardStatus.Loading
        if (showLoading && prev.status !== DashboardStatus.Loading) {
          if (isStale()) return
          setState((s) => ({ ...s, error: undefined, status: DashboardStatus.Loading }))
        }

        const request = (pageNumber: number) =>
          timeoutRace(requestTimeoutMs, () =>
            loadPage({
              repo,
              scope,
              statusFilter,
              currentBranch: branch,
              first: pageSize,
              after: pageCursors[pageNumber] ?? null,
              requestTimeoutMs,
            }),
          )
        let result = await request(targetPage)
        // PRs can drop out of the list between refreshes, leaving a later
        // page empty. Fall back to the first page.
        if (result.prs.length === 0 && targetPage > 0) {
          if (isStale()) return
          targetPage = 0
          result = await request(0)
        }
        if (isStale()) return
        pageCursors.length = targetPage + 1
        if (result.hasNextPage && result.endCursor) pageCursors[targetPage + 1] = result.endCursor
        cursors = pageCursors
        cursorsKey = listKey
        setState((s) => ({
          ...s,
          status: DashboardStatus.Ok,
          repo,
          prs: result.prs,
          currentBranch: branch,
          viewerLogin: result.viewerLogin ?? s.viewerLogin,
          page: targetPage,
          totalCount: result.totalCount,
          hasNextPage: result.hasNextPage && !!result.endCursor,
          error: undefined,
          errorKind: undefined,
          fetchedAt: Date.now(),
        }))
      } catch (e: unknown) {
        if (isStale()) return
        const rl = parseRateLimitError(e)
        setState((s) => ({
          ...s,
          status: DashboardStatus.Error,
          repo: s.repo,
          prs: rl.isRateLimit ? s.prs : [],
          error: rl.message ?? prListErrorMessage(e),
          errorKind: rl.isRateLimit ? "rate-limit" : prListErrorKind(e),
          fetchedAt: Date.now(),
        }))
      }
    })()
    currentRefreshToken = token
    inFlight = promise
    inFlightKey = requestKey
    promise.finally(release)
    return inFlight
  }

  const refreshOne = async (n: number) => {
    const prs = state().prs
    const idx = prs.findIndex((p) => p.number === n)
    if (idx < 0) return
    const repo = state().repo
    if (!repo) return
    try {
      const updated = await fetchOnePR(repo, n)
      setState((s) => ({
        ...s,
        prs: s.prs.map((p) => p.number === n
          ? {
              ...updated,
              checkStatuses: updated.checkStatuses ?? p.checkStatuses,
              reviewThreads: updated.reviewThreads ?? p.reviewThreads,
            }
          : p),
        fetchedAt: Date.now(),
      }))
    } catch {}
  }

  return { refresh, refreshOne }
}

function timeoutRace<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms / 1000}s`))
    }, ms)
    fn().then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}
