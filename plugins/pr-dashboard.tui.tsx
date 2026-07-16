/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { spawn } from "./bun-utils"
import type { TuiPR as PR, Repo, Filter, State, Status } from "./domain/types"
import { BOT_ALIASES, displayLogin, ellipsize } from "./domain/login"
import { SK, skin, toHex, truncateTitle } from "./domain/format"
import {
  classifyCI,
  reviewSummary,
  missingReviewerCount,
  isReadyToMerge,
  fmtAge,
} from "./domain/pr-status"
import { FILTERS, filterPRs } from "./domain/filter"

export type { PR, Repo, Filter, State, Status }
export { SK, skin, toHex, truncateTitle }
export {
  classifyCI,
  reviewSummary,
  missingReviewerCount,
  isReadyToMerge,
  fmtAge,
}
export { FILTERS, filterPRs }
export { BOT_ALIASES, displayLogin, ellipsize }

export const JSON_FIELDS = [
  "number",
  "title",
  "url",
  "isDraft",
  "author",
  "headRefName",
  "baseRefName",
  "reviewDecision",
  "mergeable",
  "mergeStateStatus",
  "createdAt",
  "updatedAt",
  "statusCheckRollup",
  "reviewRequests",
  "latestReviews",
].join(",")

const command = {
  refresh: "pr_dashboard.refresh",
  open: "pr_dashboard.open",
  addReviewer: "pr_dashboard.add_reviewer",
  reRequestReview: "pr_dashboard.rerequest_review",
  addCurrentBranch: "pr_dashboard.add_current_branch",
}

export async function detectRepo(): Promise<Repo> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const proc = spawn({
        cmd: ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        stdout: "pipe",
        stderr: "pipe",
      })
      const text: string[] = []
      const err: string[] = []
      proc.stdout.pipeTo(new WritableStream({ write: (chunk) => (text.push(new TextDecoder().decode(chunk))) }))
      proc.stderr.pipeTo(new WritableStream({ write: (chunk) => (err.push(new TextDecoder().decode(chunk))) }))
      proc.exited.then((code) => {
        if (code === 0) resolve(text.join("").trim())
        else reject(new Error(err.join("").trim() || `gh exited ${code}`))
      })
    })
    const [owner, repo] = out.split("/")
    return owner && repo ? { owner, repo } : null
  } catch {
    return null
  }
}

export async function fetchPRs(): Promise<PR[]> {
  return new Promise<PR[]>((resolve, reject) => {
    const proc = spawn({
      cmd: [
        "gh",
        "pr",
        "list",
        "--state",
        "open",
        "--json",
        JSON_FIELDS,
        "--limit",
        "50",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const text: string[] = []
    const err: string[] = []
    proc.stdout.pipeTo(new WritableStream({ write: (chunk) => (text.push(new TextDecoder().decode(chunk))) }))
    proc.stderr.pipeTo(new WritableStream({ write: (chunk) => (err.push(new TextDecoder().decode(chunk))) }))
    proc.exited.then((code) => {
      if (code !== 0) {
        reject(new Error(err.join("").trim() || `gh pr list exited ${code}`))
        return
      }
      try {
        resolve(JSON.parse(text.join("")) as PR[])
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

export async function currentBranchPR(): Promise<PR | null> {
  return new Promise<PR | null>((resolve) => {
    const proc = spawn({
      cmd: ["gh", "pr", "view", "--json", JSON_FIELDS],
      stdout: "pipe",
      stderr: "pipe",
    })
    const text: string[] = []
    const err: string[] = []
    proc.stdout.pipeTo(new WritableStream({ write: (chunk) => (text.push(new TextDecoder().decode(chunk))) }))
    proc.stderr.pipeTo(new WritableStream({ write: (chunk) => (err.push(new TextDecoder().decode(chunk))) }))
    proc.exited.then((code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      try {
        const data = JSON.parse(text.join(""))
        if (data && typeof data.number === "number") resolve(data as PR)
        else resolve(null)
      } catch {
        resolve(null)
      }
    })
  })
}

export async function runGh(args: string[]): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn({ cmd: args, stdout: "pipe", stderr: "pipe" })
    const out: string[] = []
    const err: string[] = []
    proc.stdout.pipeTo(new WritableStream({ write: (chunk) => (out.push(new TextDecoder().decode(chunk))) }))
    proc.stderr.pipeTo(new WritableStream({ write: (chunk) => (err.push(new TextDecoder().decode(chunk))) }))
    proc.exited.then((code) => {
      resolve({
        ok: code === 0,
        output: out.join("").trim(),
        error: code !== 0 ? err.join("").trim() || `gh exited ${code}` : undefined,
      })
    })
  })
}

export const THREAD_COUNT_QUERY = `query Q($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        reviewThreads(first: 100) {
          totalCount
          nodes {
            isResolved
            comments(first: 20) {
              nodes {
                author { login }
              }
            }
          }
        }
      }
    }
  }
}`

export { type ReviewerThreadCounts } from "./domain/types"

export async function fetchReviewerThreadCounts(
  owner: string,
  repo: string,
): Promise<Map<number, ReviewerThreadCounts>> {
  const res = await runGh([
    "gh",
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${repo}`,
    "-f",
    `query=${THREAD_COUNT_QUERY}`,
  ])
  const out = new Map<number, ReviewerThreadCounts>()
  if (!res.ok) return out
  try {
    const data = JSON.parse(res.output)
    const nodes = data?.data?.repository?.pullRequests?.nodes ?? []
    const normalize = (l: string) => l.replace(/\[bot\]$/, "")
    for (const n of nodes) {
      const threads = n.reviewThreads?.nodes ?? []
      const byReviewer = new Map<string, { unresolved: number; resolved: number }>()
      const bump = (login: string, kind: "unresolved" | "resolved") => {
        const key = normalize(login)
        if (!key) return
        const cur = byReviewer.get(key) ?? { unresolved: 0, resolved: 0 }
        cur[kind]++
        byReviewer.set(key, cur)
      }
      for (const t of threads) {
        const authors = new Set<string>()
        for (const c of t.comments?.nodes ?? []) {
          const a = c.author?.login
          if (a) authors.add(a)
        }
        for (const a of authors) {
          bump(a, t.isResolved ? "resolved" : "unresolved")
        }
      }
      out.set(n.number, byReviewer)
    }
  } catch {}
  return out
}

export const REVIEWER_THREADS_QUERY = `query Q($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        totalCount
        nodes {
          isResolved
          comments(first: 20) {
            nodes {
              author { login }
              body
              createdAt
              path
              line
            }
          }
        }
      }
    }
  }
}`

export async function fetchReviewerThreads(
  owner: string,
  repo: string,
  prNumber: number,
  reviewerLogin: string,
): Promise<string> {
  const res = await runGh([
    "gh",
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${repo}`,
    "-F",
    `number=${prNumber}`,
    "-F",
    `query=${REVIEWER_THREADS_QUERY}`,
  ])
  if (!res.ok) return `_Failed to fetch threads: ${res.error ?? "unknown error"}_`
  try {
    const data = JSON.parse(res.output)
    const threads: any[] = data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
    const normalize = (l: string) => l.replace(/\[bot\]$/, "")
    const target = normalize(reviewerLogin)
    const rows: string[] = []
    for (const t of threads) {
      if (t.isResolved) continue
      const comments: any[] = t.comments?.nodes ?? []
      const hasReviewer = comments.some(
        (c: any) => normalize(c.author?.login ?? "") === target,
      )
      if (!hasReviewer) continue
      const own = comments.filter(
        (c: any) => normalize(c.author?.login ?? "") === target,
      )
      const c = own[0] ?? comments[0]
      const author = (c.author?.login ?? "").replace(/\[bot\]$/, "")
      const file = c.path ?? "—"
      const line = c.line != null ? String(c.line) : "—"
      const body = own.map((x: any) => (x.body ?? "").replace(/\n/g, " ")).join(" | ")
      const bodyTrim = body.slice(0, 200)
      const date = c.createdAt?.slice(0, 10) ?? "—"
      rows.push(`| \`${file}\` | ${line} | ${bodyTrim} | ${date} |`)
    }
    if (rows.length === 0) {
      return `_No unresolved comments from @${reviewerLogin} on #${prNumber}_`
    }
    const header = `| File | Line | Comment | Date |\n|------|------|---------|------|`
    return `Unresolved comments from @${reviewerLogin} on #${prNumber}:\n\n${header}\n${rows.join("\n")}`
  } catch {
    return "_Failed to parse response_"
  }
}

export async function fetchBranchRequiredReviews(owner: string, repo: string, branch: string): Promise<number | null> {
  const res = await runGh([
    "gh",
    "api",
    `repos/${owner}/${repo}/branches/${branch}/protection/required_pull_request_reviews`,
  ])
  if (!res.ok) return null
  try {
    const data = JSON.parse(res.output)
    const n = data?.required_approving_reviewers_count
    return typeof n === "number" ? n : null
  } catch {
    return null
  }
}

export async function fetchOrgMembers(org: string): Promise<string[]> {
  const res = await runGh([
    "gh",
    "api",
    `orgs/${org}/members`,
    "--jq",
    ".[].login",
  ])
  if (!res.ok) return []
  return res.output
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function fetchCurrentUser(): Promise<string | null> {
  const res = await runGh(["gh", "api", "user", "--jq", ".login"])
  if (!res.ok) return null
  const login = res.output.trim()
  return login || null
}

export function useDashboard(api: TuiPluginApi) {
  const [state, setState] = createSignal<State>({
    status: "loading",
    repo: null,
    prs: [],
    fetchedAt: null,
    threadCounts: new Map(),
    branchRules: new Map(),
    currentUser: null,
    filter: "all",
  })
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [expanded, setExpanded] = createSignal(true)

  const toggleExpanded = () => setExpanded((v) => !v)
  const cycleFilter = () => {
    setState((s) => {
      const idx = FILTERS.indexOf(s.filter)
      const next = FILTERS[(idx + 1) % FILTERS.length]
      return { ...s, filter: next }
    })
  }

  const refresh = async () => {
    const prev = state()
    const repo = await detectRepo()
    const isFirstLoad = prev.fetchedAt === null
    const isDirChange =
      !!prev.repo && !!repo && (prev.repo.owner !== repo.owner || prev.repo.repo !== repo.repo)
    const showLoading = isFirstLoad || isDirChange
    if (showLoading) {
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
      const prs = await fetchPRs()
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
    fetchCurrentUser().then((login) => {
      if (login) setState((s) => ({ ...s, currentUser: login }))
    })
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

function CIIndicator(props: { ci: ReturnType<typeof classifyCI>; pass: string; fail: string; warn: string; muted: string }) {
  const sym = { pass: "✓", fail: "✗", pending: "•", none: " " }[props.ci]
  const color = { pass: props.pass, fail: props.fail, pending: props.warn, none: props.muted }[props.ci]
  return <text fg={color}>{sym}</text>
}

function PRRow(props: {
  pr: PR
  onClick: () => void
  onReviewer: () => void
  onReviewerComments: (login: string) => void
  text: string
  muted: string
  pass: string
  fail: string
  warn: string
  draft: string
  required: number | null | undefined
  threadCount: ReviewerThreadCounts
}) {
  const numStr = String(props.pr.number)
  const title = truncateTitle(props.pr.title, numStr.length + 1)
  const ready = isReadyToMerge(props.pr, props.required)
  const blocked =
    props.pr.mergeStateStatus === "CONFLICTING" ||
    props.pr.mergeable === "CONFLICTING" ||
    reviewSummary(props.pr).changes > 0
  const numColor = props.pr.isDraft || blocked ? props.draft : ready ? props.pass : props.text
  const titleColor = numColor
  const r = reviewSummary(props.pr)
  const missing = missingReviewerCount(props.pr, props.required)
  const showAdd = missing > 0 || (r.approved === 0 && r.changes === 0 && r.pending === 0 && r.commented === 0)

  const reviewerBoxes: any[] = []
  const pushReviewer = (el: any) => {
    if (reviewerBoxes.length > 0) reviewerBoxes.push(<text>{" "}</text>)
    reviewerBoxes.push(el)
  }

  r.approvedLogins.forEach((l) =>
    pushReviewer(<text fg={props.pass}>{`${ellipsize(displayLogin(l))}✓ `}</text>),
  )
  r.changesLogins.forEach((l) =>
    pushReviewer(<text fg={props.fail}>{`${ellipsize(displayLogin(l))}± `}</text>),
  )
  r.pendingLogins.forEach((l) =>
    pushReviewer(<text fg={props.warn}>{`${ellipsize(displayLogin(l))}• `}</text>),
  )
  r.commentedLogins.forEach((l) => {
    const tc = props.threadCount.get(l) ?? { unresolved: 0, resolved: 0 }
    const icon = tc.unresolved > 0 ? "☐" : tc.resolved > 0 ? "☑" : ""
    const login = displayLogin(l)
    if (tc.unresolved > 0) {
      pushReviewer(
        <box
          onMouseUp={(e: any) => {
            e?.stopPropagation?.()
            props.onReviewerComments(l)
          }}
        >
          <text fg={props.muted}><u>{`${ellipsize(login)}${icon} `}</u></text>
        </box>,
      )
    } else {
      pushReviewer(<text fg={props.muted}>{`${ellipsize(login)}${icon} `}</text>)
    }
  })

  return (
    <box
      flexDirection="column"
      paddingLeft={0}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      onMouseUp={() => props.onClick()}
    >
      <box flexDirection="row" gap={1}>
        <CIIndicator
          ci={classifyCI(props.pr)}
          pass={props.pass}
          fail={props.fail}
          warn={props.warn}
          muted={props.muted}
        />
        <text fg={numColor}>
          <b>#{numStr}</b>
        </text>
        <text fg={titleColor}>{title}</text>
      </box>
      <box flexDirection="row" flexWrap="no-wrap" gap={0} paddingLeft={2}>
        <Show when={reviewerBoxes.length > 0} fallback={<text> </text>}>
          {reviewerBoxes}
        </Show>
        <Show when={showAdd}>
          <box
            onMouseUp={(e: any) => {
              e?.stopPropagation?.()
              props.onReviewer()
            }}
          >
            <text fg={props.muted}><u> add {missing > 0 ? missing : "reviewers"}</u></text>
          </box>
        </Show>
      </box>
    </box>
  )
}

function DashboardView(props: {
  api: TuiPluginApi
  state: State
  onRefresh: () => void
  selectedIdx: number
  setSelectedIdx: (n: number) => void
  onOpen: (n: number) => void
  onAddReviewer: (n: number) => void
  onReviewerComments: (n: number, login: string) => void
  filter: Filter
  onCycleFilter: () => void
  expanded: boolean
  onToggleExpand: () => void
}) {
  const sk = skin(props.api)
  const filtered = createMemo(() =>
    filterPRs(props.state.prs, props.filter, props.state.currentUser),
  )
  const visible = createMemo(() => filtered().slice(0, 30))
  const counts = createMemo(() => {
    let ready = 0
    let notReady = 0
    for (const pr of filtered()) {
      const required = props.state.branchRules.get(pr.baseRefName) ?? null
      if (isReadyToMerge(pr, required)) ready++
      else notReady++
    }
    return { ready, notReady, total: filtered().length }
  })

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0}>
      <box flexDirection="row" gap={1} paddingLeft={0} paddingRight={1} onMouseUp={() => props.onToggleExpand()}>
        <text fg={sk.text}>{props.expanded ? "▼" : "▶"}</text>
        <text fg={sk.text}>
          <b>PRs</b>
        </text>
        <Show when={props.state.status === "ok"}>
          <text fg={sk.success}>{counts().ready}✓</text>
          <text fg={sk.text}>{counts().notReady}•</text>
        </Show>
        <Show when={props.state.status === "loading"}>
          <text fg={sk.muted}>loading…</text>
        </Show>
        <Show when={props.state.status === "error"}>
          <text fg={sk.error}>error</text>
        </Show>
        <Show when={props.state.status === "no-repo"}>
          <text fg={sk.muted}>no gh repo</text>
        </Show>
        <box flexGrow={1}></box>
        <Show when={props.state.status !== "no-repo"}>
          <box
            onMouseUp={(e: any) => {
              e?.stopPropagation?.()
              props.onCycleFilter()
            }}
          >
            <text fg={sk.muted}>{props.filter}</text>
          </box>
        </Show>
      </box>

      <Show when={props.state.status === "no-repo"}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted}>No GitHub repo detected in this directory.</text>
          <text fg={sk.muted}>Run `gh auth status` to confirm authentication.</text>
        </box>
      </Show>

      <Show when={props.state.status === "error"}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.error}>Error</text>
        </box>
      </Show>

      <Show when={props.expanded && props.state.status === "ok" && props.state.prs.length === 0}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted}>No open PRs.</text>
        </box>
      </Show>

      <Show when={props.expanded && props.state.status === "ok" && props.state.prs.length > 0}>
        <box flexDirection="column" gap={1} paddingTop={0}>
          <For each={visible()}>
            {(pr, i) => (
              <PRRow
                pr={pr}
                onClick={() => {
                  props.setSelectedIdx(i())
                  props.onOpen(pr.number)
                }}
                onReviewer={() => {
                  props.setSelectedIdx(i())
                  props.onAddReviewer(pr.number)
                }}
                onReviewerComments={(login) => {
                  props.setSelectedIdx(i())
                  props.onReviewerComments(pr.number, login)
                }}
                text={sk.text}
                muted={sk.muted}
                pass={sk.success}
                fail={sk.error}
                warn={sk.warning}
                draft={SK.draft}
                required={props.state.branchRules.get(pr.baseRefName) ?? null}
                threadCount={props.state.threadCounts.get(pr.number) ?? new Map()}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return
  const ctx = useDashboard(api)

  const openPR = async (n: number) => {
    const pr = ctx.state().prs.find((p) => p.number === n)
    if (!pr) return
    const proc = spawn({ cmd: ["open", pr.url], stdout: "ignore", stderr: "ignore" })
    api.ui.toast({ variant: "info", message: `Opening #${n} in browser…`, duration: 1500 })
    await proc.exited
  }

  const promptReviewer = async (n: number, kind: "add" | "rerequest"): Promise<void> => {
    const label = kind === "add" ? "Add reviewer to" : "Re-request review on"
    const repo = ctx.state().repo
    const members = repo ? await fetchOrgMembers(repo.owner) : []
    const sk = skin(api)
    api.ui.dialog.setSize("large")
    api.ui.dialog.replace(() => {
      const DialogPrompt = api.ui.DialogPrompt
      return (
        <DialogPrompt
          title={`${label} #${n}`}
          placeholder="@username or org/team"
          description={() => (
            <box flexDirection="column">
              <Show when={members.length > 0}>
                <text fg={sk.muted}>Suggested ({members.length} from {repo?.owner}):</text>
                <For each={members.slice(0, 25)}>
                  {(m) => <text fg={sk.text}>  @{m}</text>}
                </For>
                <Show when={members.length > 25}>
                  <text fg={sk.muted}>  … and {members.length - 25} more</text>
                </Show>
              </Show>
              <Show when={members.length === 0}>
                <text fg={sk.muted}>Type any username, team (org/team), or paste a GitHub handle.</text>
              </Show>
            </box>
          )}
          onConfirm={async (value) => {
            const reviewer = value.trim().replace(/^@/, "")
            if (!reviewer) {
              api.ui.dialog.clear()
              return
            }
            const res = await runGh(["gh", "pr", "edit", String(n), "--add-reviewer", reviewer])
            api.ui.dialog.clear()
            if (res.ok) {
              api.ui.toast({ variant: "success", message: `Requested @${reviewer} on #${n}`, duration: 2000 })
              ctx.refreshOne(n)
            } else {
              api.ui.toast({ variant: "error", message: `Failed: ${res.error ?? "unknown"}`, duration: 4000 })
            }
          }}
          onCancel={() => api.ui.dialog.clear()}
        />
      )
    })
  }

  const showReviewerComments = async (n: number, login: string): Promise<void> => {
    const repo = ctx.state().repo
    if (!repo) return
    const sessionID = api.route.current?.name === "session" ? api.route.current?.params?.sessionID : undefined
    if (typeof sessionID !== "string") {
      api.ui.toast({ variant: "error", message: "No active session", duration: 2000 })
      return
    }
    api.ui.toast({ variant: "info", message: `Loading threads from @${login}…`, duration: 1200 })
    const table = await fetchReviewerThreads(repo.owner, repo.repo, n, login)
    try {
      const res = await api.client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: `\n${table}\n`, ignored: true }],
        },
      } as any)
      if ((res as any)?.error) {
        api.ui.toast({ variant: "error", message: `Failed: ${(res as any).error}`, duration: 3000 })
      } else {
        api.ui.toast({ variant: "success", message: `Posted @${login}'s comments to chat`, duration: 1500 })
      }
    } catch (e: any) {
      api.ui.toast({ variant: "error", message: `Failed: ${e?.message ?? "unknown"}`, duration: 3000 })
    }
  }

  const slots: TuiSlotPlugin = {
    order: 250,
    slots: {
      sidebar_content(_ctx, value) {
        return (
          <DashboardView
            api={api}
            state={ctx.state()}
            onRefresh={ctx.refresh}
            selectedIdx={ctx.selectedIdx()}
            setSelectedIdx={ctx.setSelectedIdx}
            onOpen={openPR}
            onAddReviewer={(n) => promptReviewer(n, "add")}
            onReviewerComments={(n, login) => showReviewerComments(n, login)}
            expanded={ctx.expanded()}
            onToggleExpand={ctx.toggleExpanded}
            filter={ctx.state().filter}
            onCycleFilter={ctx.cycleFilter}
          />
        )
      },
    },
  }
  api.slots.register(slots)

  api.keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: command.refresh,
        title: "PRs: Refresh dashboard",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-refresh",
        run() {
          ctx.refresh()
          api.ui.toast({ variant: "info", message: "Refreshing PRs…", duration: 1200 })
        },
      },
      {
        name: command.open,
        title: "PRs: Open selected in browser",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-open",
        enabled: () => ctx.state().prs.length > 0,
        run() {
          const pr = ctx.state().prs[ctx.selectedIdx()]
          if (pr) openPR(pr.number)
        },
      },
      {
        name: command.addReviewer,
        title: "PRs: Add reviewer to selected",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-add-reviewer",
        enabled: () => ctx.state().prs.length > 0,
        run() {
          const pr = ctx.state().prs[ctx.selectedIdx()]
          if (pr) promptReviewer(pr.number, "add")
        },
      },
      {
        name: command.reRequestReview,
        title: "PRs: Re-request review on selected",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-rerequest-review",
        enabled: () => ctx.state().prs.length > 0,
        run() {
          const pr = ctx.state().prs[ctx.selectedIdx()]
          if (pr) promptReviewer(pr.number, "rerequest")
        },
      },
      {
        name: command.addCurrentBranch,
        title: "PRs: Add reviewer to current branch PR",
        category: "PR Dashboard",
        namespace: "palette",
        slashName: "pr-add-reviewer-current",
        run: async () => {
          const pr = await currentBranchPR()
          if (!pr) {
            api.ui.toast({ variant: "warning", message: "No PR for current branch", duration: 2000 })
            return
          }
          promptReviewer(pr.number, "add")
        },
      },
    ],
    bindings: [],
  })

  api.event.on("session.idle", () => {
    ctx.refresh()
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "pr-dashboard",
  tui,
}

export default plugin
