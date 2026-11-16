/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { DashboardStatus, type PRFilter, type DashboardState } from "../domain/types"
import { skin } from "./theme"
import { classifyRowState } from "../domain/pr-status"
import { errorMessages } from "../domain/messages"
import { PRRow } from "./PRRow"

export function DashboardView(props: {
  api: TuiPluginApi
  state: DashboardState
  onRefresh: () => void
  selectedIdx: number
  setSelectedIdx: (n: number) => void
  onOpen: (n: number) => void
  onAddReviewer: (n: number) => void
  onReviewerComments: (n: number, login: string) => void
  filter: PRFilter
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
      if (classifyRowState(pr) === "ready") ready++
      else notReady++
    }
    return { ready, notReady, total: props.state.prs.length }
  })

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0}>
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={0}
        paddingRight={0}
        onMouseUp={() => props.onToggleExpand()}
      >
        <text fg={sk.text}>{props.expanded ? "▼" : "▶"}</text>
        <text fg={sk.text}>
          <b>PRs</b>
        </text>
        <Show when={props.state.status === DashboardStatus.Ok}>
          <text fg={sk.success}>{counts().ready}✓</text>
          <text fg={sk.text}>{counts().notReady}•</text>
        </Show>
        <Show when={props.state.status === DashboardStatus.Loading}>
          <text fg={sk.muted}>Loading</text>
        </Show>
        <Show when={props.state.status === DashboardStatus.Error}>
          <text fg={sk.error}>Error</text>
        </Show>
        <Show when={props.state.status === DashboardStatus.NoRepo}>
          <text fg={sk.muted}>{errorMessages.noRepo}</text>
        </Show>
        <box flexGrow={1}></box>
        <Show when={props.state.status !== DashboardStatus.NoRepo}>
          <box
            onMouseUp={(e: any) => {
              e?.stopPropagation?.()
              props.onCycleFilter()
            }}
          >
            <text fg={sk.muted}>{`${props.filter}:@me`}</text>
          </box>
        </Show>
      </box>

      <Show when={props.state.status === DashboardStatus.NoRepo}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1} selectable={false}>
          <text fg={sk.muted} selectable={false}>{errorMessages.noRepo}</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.Error}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1} gap={1} selectable={false}>
          <text fg={sk.error} selectable={false}>{props.state.error ?? errorMessages.unknown}</text>
        </box>
      </Show>

      <Show when={props.expanded && props.state.status === DashboardStatus.Ok && props.state.prs.length === 0}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1} selectable={false}>
          <text fg={sk.muted} selectable={false}>{errorMessages.noOpenPRs}</text>
        </box>
      </Show>

      <Show when={props.expanded && props.state.status === DashboardStatus.Ok && props.state.prs.length > 0}>
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
                draft={sk.draft}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
