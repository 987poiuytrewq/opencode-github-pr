/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import type { Filter, Status } from "../domain/types"

export function Header(props: {
  sk: {
    text: string
    muted: string
    success: string
    error: string
    warning: string
  }
  status: Status
  expanded: boolean
  onToggleExpand: () => void
  filter: Filter
  onCycleFilter: () => void
  readyCount: number
  notReadyCount: number
}) {
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={0}
      paddingRight={1}
      onMouseUp={() => props.onToggleExpand()}
    >
      <text fg={props.sk.text}>{props.expanded ? "▼" : "▶"}</text>
      <text fg={props.sk.text}>
        <b>PRs</b>
      </text>
      <Show when={props.status === "ok"}>
        <text fg={props.sk.success}>{props.readyCount}✓</text>
        <text fg={props.sk.text}>{props.notReadyCount}•</text>
      </Show>
      <Show when={props.status === "loading"}>
        <text fg={props.sk.muted}>loading…</text>
      </Show>
      <Show when={props.status === "error"}>
        <text fg={props.sk.error}>error</text>
      </Show>
      <Show when={props.status === "no-repo"}>
        <text fg={props.sk.muted}>no gh repo</text>
      </Show>
      <box flexGrow={1}></box>
      <Show when={props.status !== "no-repo"}>
        <box
          onMouseUp={(e: any) => {
            e?.stopPropagation?.()
            props.onCycleFilter()
          }}
        >
          <text fg={props.sk.muted}>{props.filter}</text>
        </box>
      </Show>
    </box>
  )
}
