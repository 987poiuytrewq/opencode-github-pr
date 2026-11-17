/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import { DashboardStatus } from "../domain/types"
import { errorMessages } from "../domain/messages"
import type { Skin } from "./theme"

export function Header(props: {
  sk: Skin
  status: DashboardStatus
  expanded: boolean
  onToggleExpand: () => void
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
        <b>Changes</b>
      </text>
      <Show when={props.status === DashboardStatus.Loading}>
        <text fg={props.sk.muted}>Loading</text>
      </Show>
      <Show when={props.status === DashboardStatus.Error}>
        <text fg={props.sk.error}>Error</text>
      </Show>
      <Show when={props.status === DashboardStatus.NoRepo}>
        <text fg={props.sk.muted}>{errorMessages.noRepo}</text>
      </Show>
    </box>
  )
}
