/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Filter, State } from "../domain/types"
import { SK, skin } from "../domain/format"
import { isReadyToMerge } from "../domain/pr-status"
import { Header } from "./Header"
import { PRRow } from "./PRRow"
import type { ReviewerThreadCounts } from "../infra/loader"

export function DashboardView(props: {
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
  const visible = createMemo(() => props.state.prs.slice(0, 30))
  const counts = createMemo(() => {
    let ready = 0
    let notReady = 0
    for (const pr of props.state.prs) {
      const required = props.state.branchRules.get(pr.baseRefName) ?? null
      if (isReadyToMerge(pr, required)) ready++
      else notReady++
    }
    return { ready, notReady, total: props.state.prs.length }
  })

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0}>
      <Header
        sk={sk}
        status={props.state.status}
        expanded={props.expanded}
        onToggleExpand={props.onToggleExpand}
        filter={props.filter}
        onCycleFilter={props.onCycleFilter}
        readyCount={counts().ready}
        notReadyCount={counts().notReady}
      />

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
                threadCount={
                  props.state.threadCounts.get(pr.number) ??
                  (new Map() as ReviewerThreadCounts)
                }
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
