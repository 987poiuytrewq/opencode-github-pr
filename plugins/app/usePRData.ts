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
  type Repo,
} from "../domain/types"
import { currentBranch, detectRepo } from "../infra/git"
import { repositoryPRs, fetchOnePR } from "../infra/loader"
import { prListErrorKind, prListErrorMessage, parseRateLimitError } from "../domain/messages"
import { DEFAULT_MAX_PR_PAGES, DEFAULT_REQUEST_TIMEOUT_MS } from "./config"

export function useDashboard(
  api: TuiPluginContext,
  state: () => DashboardState,
  setState: (fn: (s: DashboardState) => DashboardState) => void,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  maxPRPages = DEFAULT_MAX_PR_PAGES,
): {
  refresh: () => Promise<void>
  refreshOne: (n: number) => Promise<void>
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
  let refreshToken = 0
  let currentRefreshToken = 0

  const refresh = async () => {
    if (inFlight) return inFlight
    const prev = state()
    const token = ++refreshToken
    const release = () => {
      if (inFlight && currentRefreshToken === token) inFlight = null
    }
    const promise = (async () => {
      const isStale = () => token !== refreshToken
      try {
        const directory = await cwd()
        const repo = detectRepo(directory)
        const isFirstLoad = prev.fetchedAt === null
        const isDirChange =
          !!prev.repo && !!repo && (prev.repo.owner !== repo.owner || prev.repo.repo !== repo.repo)
        const showLoading = isFirstLoad || isDirChange || prev.status === DashboardStatus.Loading
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
            listingTruncated: false,
            error: undefined,
            errorKind: undefined,
            fetchedAt: Date.now(),
          }))
          return
        }
        const result = await timeoutRace(requestTimeoutMs, () =>
          repositoryPRs(repo, maxPRPages, requestTimeoutMs),
        )
        if (isStale()) return
        setState((s) => ({
          ...s,
          status: DashboardStatus.Ok,
          repo,
          prs: result.prs,
          currentBranch: currentBranch(directory),
          viewerLogin: result.viewerLogin,
          listingTruncated: result.listingTruncated,
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
          listingTruncated: rl.isRateLimit ? s.listingTruncated : false,
          error: rl.message ?? prListErrorMessage(e),
          errorKind: rl.isRateLimit ? "rate-limit" : prListErrorKind(e),
          fetchedAt: Date.now(),
        }))
      }
    })()
    currentRefreshToken = token
    inFlight = promise
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
