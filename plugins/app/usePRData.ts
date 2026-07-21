import type { State } from "../domain/types"
import { FILTERS } from "../domain/filter"
import { detectRepo, fetchPRs, fetchReviewerThreadCounts, fetchBranchRequiredReviews } from "../infra/loader"

export function useDashboard(
  state: () => State,
  setState: (fn: (s: State) => State) => void,
) {
  const cycleFilter = () => {
    setState((s) => {
      const idx = FILTERS.indexOf(s.filter)
      const next = FILTERS[(idx + 1) % FILTERS.length]
      return { ...s, filter: next, status: "loading" as const }
    })
    refresh()
  }

  const refresh = async () => {
    const prev = state()
    const filter = prev.filter
    const repo = detectRepo()
    const isFirstLoad = prev.fetchedAt === null
    const isDirChange =
      !!prev.repo && !!repo && (prev.repo.owner !== repo.owner || prev.repo.repo !== repo.repo)
    const showLoading = isFirstLoad || isDirChange || prev.status === "loading"
    if (showLoading && prev.status !== "loading") {
      setState((s) => ({ ...s, status: "loading" }))
    }
    if (!repo) {
      setState((s) => ({
        ...s,
        status: "no-repo",
        repo: null,
        prs: [],
        fetchedAt: Date.now(),
        threadCounts: new Map(),
        branchRules: new Map(),
      }))
      return
    }
    try {
      const prs = await fetchPRs(filter, repo)
      const [threadCounts, branchRules] = await Promise.all([
        fetchReviewerThreadCounts(repo.owner, repo.repo),
        (async () => {
          const unique = Array.from(new Set(prs.map((p) => p.baseRefName)))
          const map = new Map<string, number | null>()
          await Promise.all(
            unique.map(async (b) => {
              map.set(b, await fetchBranchRequiredReviews(repo.owner, repo.repo, b))
            }),
          )
          return map
        })(),
      ])
      setState((s) => ({
        ...s,
        status: "ok",
        repo,
        prs,
        fetchedAt: Date.now(),
        threadCounts,
        branchRules,
      }))
    } catch (e) {
      if (showLoading) {
        setState((s) => ({
          ...s,
          status: "error",
          repo,
          prs: [],
          fetchedAt: Date.now(),
          threadCounts: new Map(),
          branchRules: new Map(),
        }))
      }
    }
  }

  return { state, setState, cycleFilter, refresh }
}
