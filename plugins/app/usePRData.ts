/** @jsxImportSource @opentui/solid */
import { createSignal, onMount, onCleanup } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { spawn } from "../bun-utils"
import type { State, TuiPR as PR } from "../domain/types"
import { FILTERS } from "../domain/filter"
import {
  detectRepo,
  fetchBranchRequiredReviews,
  fetchPRs,
  fetchReviewerThreadCounts,
  JSON_FIELDS,
} from "../infra/loader"

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
    const repo = await detectRepo()
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
      const prs = await fetchPRs(filter)
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
    try {
      const proc = spawn({
        cmd: ["gh", "pr", "view", String(n), "--json", JSON_FIELDS],
        stdout: "pipe",
        stderr: "pipe",
      })
      const out: string[] = []
      proc.stdout.pipeTo(new WritableStream({ write: (c) => out.push(new TextDecoder().decode(c)) }))
      await proc.exited
      const fresh = JSON.parse(out.join("")) as PR
      setState((s) => ({
        ...s,
        prs: s.prs.map((p) => (p.number === n ? fresh : p)),
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
