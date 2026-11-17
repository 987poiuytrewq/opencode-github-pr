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
  PRFilter,
  FILTERS,
  type DashboardState,
  type Repo,
} from "../domain/types"
import { detectRepo } from "../infra/git"
import { fetchDashboardData, fetchOnePR, fetchViewerLogin } from "../infra/loader"
import { prListErrorMessage, parseRateLimitError } from "../domain/messages"

export function useDashboard(
  api: TuiPluginContext,
  state: () => DashboardState,
  setState: (fn: (s: DashboardState) => DashboardState) => void,
): {
  refresh: () => Promise<void>
  refreshOne: (n: number) => Promise<void>
  cycleFilter: () => void
} {
  const cycleFilter = () => {
    setState((s) => {
      const idx = FILTERS.indexOf(s.filter)
      const next = FILTERS[(idx + 1) % FILTERS.length]
      return { ...s, filter: next, status: DashboardStatus.Loading }
    })
    refresh()
  }

  // Resolve the working directory explicitly when the TUI exposes it, so
  // repo detection doesn't depend on where opencode happens to launch.
  // Falls back to process.cwd() for tests that chdir() into a temp repo.
  const cwd = (): string =>
    api.location?.directory ?? api.data.location.default().directory ?? process.cwd()

  let inFlight: Promise<void> | null = null
  let refreshToken = 0
  let currentRefreshToken = 0
  let rateLimitedUntil = 0

  const refresh = async () => {
    if (inFlight) return inFlight
    const prev = state()
    const filter = prev.filter
    const token = ++refreshToken
    const release = () => {
      if (inFlight && currentRefreshToken === token) inFlight = null
    }
    const promise = (async () => {
      const isStale = () => token !== refreshToken
      try {
        const repo = detectRepo(cwd())
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
            error: undefined,
            fetchedAt: Date.now(),
          }))
          rateLimitedUntil = 0
          return
        }
        const TIMEOUT_MS = 15_000
        const prs = await timeoutRace(TIMEOUT_MS, async () => {
          const viewerLogin = await fetchViewerLogin()
          return fetchDashboardData(filter, repo, viewerLogin)
        })
        if (isStale()) return
        setState((s) => ({
          ...s,
          status: DashboardStatus.Ok,
          repo,
          prs,
          error: undefined,
          fetchedAt: Date.now(),
        }))
        rateLimitedUntil = 0
      } catch (e: any) {
        if (isStale()) return
        const rl = parseRateLimitError(e)
        if (rl.resetAt) rateLimitedUntil = rl.resetAt
        setState((s) => ({
          ...s,
          status: DashboardStatus.Error,
          repo: s.repo,
          prs: rl.isRateLimit ? s.prs : [],
          error: rl.message ?? prListErrorMessage(e),
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
        prs: s.prs.map((p) => (p.number === n ? updated : p)),
        fetchedAt: Date.now(),
      }))
    } catch {}
  }

  return { refresh, refreshOne, cycleFilter }
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
