/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import { DashboardStatus, type PRFilter } from "../domain/types"
import { errorMessages } from "../domain/messages"
import type { Skin } from "./theme"

export function Header(props: {
  sk: Skin
  status: DashboardStatus
  expanded: boolean
  onToggleExpand: () => void
  filter: PRFilter
  onCycleFilter: () => void
  readyCount: number
  notReadyCount: number
}) {
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={0}
      paddingRight={0}
      onMouseUp={() => props.onToggleExpand()}
    >
      <text fg={props.sk.text}>{props.expanded ? "▼" : "▶"}</text>
      <text fg={props.sk.text}>
        <b>PRs</b>
      </text>
      <Show when={props.status === DashboardStatus.Ok}>
        <text fg={props.sk.success}>{props.readyCount}✓</text>
        <text fg={props.sk.text}>{props.notReadyCount}•</text>
      </Show>
      <Show when={props.status === DashboardStatus.Loading}>
        <text fg={props.sk.muted}>Loading</text>
      </Show>
      <Show when={props.status === DashboardStatus.Error}>
        <text fg={props.sk.error}>Error</text>
      </Show>
      <Show when={props.status === DashboardStatus.NoRepo}>
        <text fg={props.sk.muted}>{errorMessages.noRepo}</text>
      </Show>
      <box flexGrow={1}></box>
      <Show when={props.status !== DashboardStatus.NoRepo}>
        <box
          onMouseUp={(e: any) => {
            e?.stopPropagation?.()
            props.onCycleFilter()
          }}
        >
          <text fg={props.sk.muted}>{`${props.filter}:@me`}</text>
        </box>
      </Show>
    </box>
  )
}
