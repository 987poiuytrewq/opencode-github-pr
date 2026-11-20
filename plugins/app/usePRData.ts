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
  type PRStatusFilter,
} from "../domain/types"
import { currentBranch, detectPushRemoteOwner, detectRepo } from "../infra/git"
import {
  DEFAULT_RECENT_PRS_LIMIT,
  repositoryPRs,
  MIN_PAGES_PER_BATCH,
} from "../infra/loader"
import { prListErrorKind, prListErrorMessage, parseRateLimitError } from "../domain/messages"
import { DEFAULT_PAGES_PER_BATCH, DEFAULT_PAGE_SIZE, DEFAULT_REQUEST_TIMEOUT_MS } from "./config"

export function useDashboard(
  api: TuiPluginContext,
  state: () => DashboardState,
  setState: (fn: (s: DashboardState) => DashboardState) => void,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  pagesPerBatch = DEFAULT_PAGES_PER_BATCH,
  statusFilter: () => PRStatusFilter = () => "open",
  scopeFilter: () => PRScope = () => "all",
  pageSize = DEFAULT_PAGE_SIZE,
  recentPRsLimit = DEFAULT_RECENT_PRS_LIMIT,
): {
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
} {
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
  let inFlightFilterKey: string | null = null
  const loadMoreInFlight = new Map<string, Promise<void>>()
  let refreshToken = 0
  let currentRefreshToken = 0
  let rateLimitResetAt: number | null = null
  let rateLimitMessage: string | null = null
  const rateLimitActive = (): boolean => {
    if (rateLimitResetAt === null) return false
    if (Date.now() >= rateLimitResetAt) {
      rateLimitResetAt = null
      rateLimitMessage = null
      return false
    }
    return true
  }
  const recordRateLimit = (error: unknown) => {
    const rateLimit = parseRateLimitError(error)
    if (rateLimit.isRateLimit) {
      rateLimitMessage = rateLimit.message
      if (rateLimit.resetAt + 2_000 > Date.now()) {
        rateLimitResetAt = rateLimit.resetAt + 2_000
      }
    }
    return rateLimit
  }
  const pageBatchSize = pageSize * Math.max(MIN_PAGES_PER_BATCH, pagesPerBatch)

  const refresh = async (): Promise<void> => {
    const listing = statusFilter()
    const scope = scopeFilter()
    if (rateLimitActive()) {
      const scopeValue = scope === "branch" ? state().currentBranch : null
      setState((s) => ({
        ...s,
        status: DashboardStatus.Error,
        pagination: {
          ...s.pagination,
          listing,
          scope,
          scopeValue,
          cursor: null,
          hasMore: false,
          totalCount: null,
          loading: false,
        },
        error: rateLimitMessage ?? s.error,
        errorKind: "rate-limit",
      }))
      return
    }
    const filterKey = `${listing}:${scope}`
    if (inFlight) {
      if (filterKey !== inFlightFilterKey) return inFlight.then((): Promise<void> => refresh())
      return inFlight
    }
    const prev = state()
    const token = ++refreshToken
    const release = () => {
      if (inFlight && currentRefreshToken === token) inFlight = null
    }
    const promise = (async () => {
      const isStale = () => token !== refreshToken
      let scopeValue: string | null = null
      try {
        const directory = await cwd()
        const [repo, branchPushOwner] = await Promise.all([
          detectRepo(directory),
          scope === "branch"
            ? detectPushRemoteOwner(directory, currentBranch(directory))
            : Promise.resolve(null),
        ])
        const branch = currentBranch(directory)
        scopeValue = scope === "branch" ? branch : null
        const isFirstLoad = prev.fetchedAt === null
        const isDirChange =
          !!prev.repo && !!repo && (prev.repo.owner !== repo.owner || prev.repo.repo !== repo.repo)
        const showLoading =
          isFirstLoad ||
          isDirChange ||
          prev.status === DashboardStatus.Loading ||
          prev.pagination.listing !== listing ||
          prev.pagination.scope !== scope ||
          prev.pagination.scopeValue !== scopeValue
        if (showLoading && prev.status !== DashboardStatus.Loading) {
          if (isStale()) return
          setState((s) => ({ ...s, error: undefined, status: DashboardStatus.Loading }))
        }
        if (!repo) {
          if (isStale()) return
          setState((s) => ({
            ...s,
            status: DashboardStatus.NoRepo,
            repo: null,
            prs: [],
            currentBranch: null,
            viewerLogin: null,
            pagination: {
              listing,
              scope,
              scopeValue,
              cursor: null,
              hasMore: false,
              totalCount: 0,
              pagesLoaded: 0,
              searchResultsFetched: 0,
              supplementalPRCount: 0,
              loading: false,
              limitReached: false,
            },
            error: undefined,
            errorKind: undefined,
            fetchedAt: Date.now(),
          }))
          return
        }
        const result = await repositoryPRs(
          repo,
          pageBatchSize,
          requestTimeoutMs,
          listing,
          null,
          scope,
          scopeValue,
          0,
          recentPRsLimit,
          branchPushOwner,
        )
        if (isStale()) return
        setState((s) => ({
          ...s,
          status: DashboardStatus.Ok,
          repo,
          prs: result.prs,
          currentBranch: branch,
          viewerLogin: result.viewerLogin ?? s.viewerLogin,
          pagination: {
            listing,
            scope,
            scopeValue,
            cursor: result.endCursor,
            hasMore: result.hasMore,
            totalCount: result.totalCount,
            pagesLoaded: result.fetchedPages,
            searchResultsFetched: result.searchResultsFetched,
            supplementalPRCount: result.supplementalPRCount,
            loading: false,
            limitReached: result.limitReached,
          },
          error: undefined,
          errorKind: undefined,
          fetchedAt: Date.now(),
        }))
      } catch (e: unknown) {
        if (isStale()) return
        const rl = recordRateLimit(e)
        setState((s) => ({
          ...s,
          status: DashboardStatus.Error,
          repo: s.repo,
          prs: rl.isRateLimit &&
              s.pagination.listing === listing &&
              s.pagination.scope === scope &&
              s.pagination.scopeValue === scopeValue
            ? s.prs
            : [],
          pagination: rl.isRateLimit &&
              s.pagination.listing === listing &&
              s.pagination.scope === scope &&
              s.pagination.scopeValue === scopeValue
            ? { ...s.pagination, loading: false }
            : {
                listing,
                scope,
                scopeValue,
                cursor: null,
                hasMore: false,
                totalCount: null,
                pagesLoaded: 0,
                searchResultsFetched: 0,
                supplementalPRCount: 0,
                loading: false,
                limitReached: false,
              },
          error: rl.message ?? prListErrorMessage(e),
          errorKind: rl.isRateLimit ? "rate-limit" : prListErrorKind(e),
          fetchedAt: Date.now(),
        }))
      }
    })()
    currentRefreshToken = token
    inFlight = promise
    inFlightFilterKey = filterKey
    promise.finally(release)
    return inFlight
  }

  const loadMore = async (): Promise<void> => {
    if (rateLimitActive()) return
    const before = state()
    const listing = statusFilter()
    const scope = scopeFilter()
    const repo = before.repo
    const cursor = before.pagination.cursor
    if (
      !repo ||
      before.pagination.listing !== listing ||
      before.pagination.scope !== scope ||
      before.pagination.scopeValue !== (scope === "branch" ? before.currentBranch : null) ||
      !before.pagination.hasMore ||
      !cursor
    ) return
    const scopeValue = before.pagination.scopeValue
    const requestKey = `${repo.owner}/${repo.repo}:${listing}:${scope}:${scopeValue ?? ""}:${cursor}`
    const existingRequest = loadMoreInFlight.get(requestKey)
    if (existingRequest) return existingRequest

    setState((s) => s.pagination.listing === listing && s.pagination.cursor === cursor
      ? { ...s, pagination: { ...s.pagination, loading: true } }
      : s)

    const promise = (async () => {
      try {
        const branchPushOwner = scope === "branch"
          ? await detectPushRemoteOwner(await cwd(), before.currentBranch)
          : null
        const result = await repositoryPRs(
          repo,
          pageBatchSize,
          requestTimeoutMs,
          listing,
          cursor,
          scope,
          scopeValue,
          before.pagination.searchResultsFetched,
          recentPRsLimit,
          branchPushOwner,
        )
        setState((s) => {
          const sameRepo = s.repo?.owner === repo.owner && s.repo.repo === repo.repo
          if (
            !sameRepo ||
            s.pagination.listing !== listing ||
            s.pagination.scope !== scope ||
            s.pagination.scopeValue !== scopeValue ||
            s.pagination.cursor !== cursor
          ) return s
          const knownNumbers = new Set(s.prs.map((pr) => pr.number))
          return {
            ...s,
            status: DashboardStatus.Ok,
            prs: [...s.prs, ...result.prs.filter((pr) => !knownNumbers.has(pr.number))],
            pagination: {
              listing,
              scope,
              scopeValue,
              cursor: result.endCursor,
              hasMore: result.hasMore,
              totalCount: s.pagination.supplementalPRCount > 0
                ? s.pagination.totalCount
                : scope === "branch"
                  ? s.pagination.totalCount === null
                    ? null
                    : Math.max(0, s.pagination.totalCount - result.filteredPRCount)
                  : result.totalCount ?? s.pagination.totalCount,
              pagesLoaded: s.pagination.pagesLoaded + result.fetchedPages,
              searchResultsFetched: s.pagination.searchResultsFetched + result.searchResultsFetched,
              supplementalPRCount: s.pagination.supplementalPRCount,
              loading: false,
              limitReached: result.limitReached,
            },
            viewerLogin: result.viewerLogin ?? s.viewerLogin,
            fetchedAt: Date.now(),
            error: undefined,
            errorKind: undefined,
          }
        })
      } catch (e: unknown) {
        const rl = recordRateLimit(e)
        setState((s) =>
          s.pagination.listing === listing &&
            s.pagination.scope === scope &&
            s.pagination.scopeValue === scopeValue &&
            s.pagination.cursor === cursor
          ? {
              ...s,
              status: DashboardStatus.Error,
              pagination: { ...s.pagination, loading: false },
              error: rl.message ?? prListErrorMessage(e),
              errorKind: rl.isRateLimit ? "rate-limit" : prListErrorKind(e),
              fetchedAt: Date.now(),
            }
          : s)
      }
    })()
    loadMoreInFlight.set(requestKey, promise)
    try {
      await promise
    } finally {
      if (loadMoreInFlight.get(requestKey) === promise) loadMoreInFlight.delete(requestKey)
    }
  }

  return { refresh, loadMore }
}
