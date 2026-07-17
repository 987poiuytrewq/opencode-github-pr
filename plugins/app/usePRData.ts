import { createSignal, onMount, onCleanup } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { State, TuiPR } from "../domain/types"
import { FILTERS } from "../domain/filter"
import {
  detectRepo,
  fetchBranchRequiredReviews,
  fetchPRs,
  fetchReviewerThreadCounts,
  type Repo,
} from "../infra/loader"
import { getOctokit } from "../infra/octokit"

export function useDashboard(api: TuiPluginApi) {
  const [state, setState] = createSignal<State>({
    status: "loading",
    repo: null,
    prs: [],
    fetchedAt: null,
    threadCounts: new Map(),
    branchRules: new Map(),
    filter: "author",
  })
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [expanded, setExpanded] = createSignal(true)

  const toggleExpanded = () => setExpanded((v) => !v)
  const cycleFilter = () => {
    setState((s) => {
      const idx = FILTERS.indexOf(s.filter)
      const next = FILTERS[(idx + 1) % FILTERS.length]
      return { ...s, filter: next, status: "loading" }
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
      setSelectedIdx((i) => Math.min(i, Math.max(0, prs.length - 1)))
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

  const refreshOne = async (n: number) => {
    const prs = state().prs
    const idx = prs.findIndex((p) => p.number === n)
    if (idx < 0) return
    const repo = state().repo as Repo | null
    if (!repo) return
    try {
      const octokit = await getOctokit()
      const { data } = await octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: n,
      })
      const updated = mapPull(data)
      setState((s) => ({
        ...s,
        prs: s.prs.map((p) => (p.number === n ? updated : p)),
        fetchedAt: Date.now(),
      }))
    } catch {}
  }

  onMount(() => {
    refresh()
    const handle = setInterval(() => {
      if (api.route.current.name === "session") refresh()
    }, 60_000)
    onCleanup(() => clearInterval(handle))
  })

  return {
    state,
    refresh,
    refreshOne,
    selectedIdx,
    setSelectedIdx,
    expanded,
    toggleExpanded,
    cycleFilter,
  }
}

function mapPull(p: any): TuiPR {
  return {
    number: p.number,
    title: p.title,
    url: p.html_url,
    isDraft: p.draft ?? false,
    author: p.user ? { login: p.user.login } : null,
    headRefName: p.head.ref,
    baseRefName: p.base.ref,
    reviewDecision: p.review_decision ?? null,
    mergeable: p.mergeable ? "MERGEABLE" : p.mergeable === false ? "CONFLICTING" : "UNKNOWN",
    mergeStateStatus: p.mergeable_state ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    statusCheckRollup: p.status_check_rollup ?? null,
    reviewRequests: (p.requested_reviewers ?? []).map((r: any) => ({ login: r.login })),
    latestReviews: (p.latest_reviews ?? []).map((r: any) => ({
      author: { login: r.user?.login ?? "" },
      state: r.state,
      createdAt: r.submitted_at ?? "",
    })),
    assignees: (p.assignees ?? []).map((a: any) => ({ login: a.login })),
  }
}
