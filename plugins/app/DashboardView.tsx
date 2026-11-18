/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { DashboardStatus, type DashboardState } from "../domain/types"
import { skin } from "./theme"
import { errorMessages } from "../domain/messages"
import { PRRow } from "./PRRow"

export function DashboardView(props: {
  theme: ResolvedTheme
  state: DashboardState
  onRefresh: () => void
  selectedIdx: number
  setSelectedIdx: (n: number) => void
  onOpen: (n: number) => void
}) {
  const sk = skin(props.theme)
  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0}>
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={0}
        paddingRight={0}
      >
        <text fg={sk.text}>
          <b>Pull Requests</b>
        </text>
        <Show when={props.state.status === DashboardStatus.Loading}>
          <text fg={sk.muted}>Loading</text>
        </Show>
        <Show when={props.state.status === DashboardStatus.Error}>
          <text fg={sk.error}>Error</text>
        </Show>
        <Show when={props.state.status === DashboardStatus.NoRepo}>
          <text fg={sk.muted}>{errorMessages.noRepo}</text>
        </Show>
      </box>

      <Show when={props.state.status === DashboardStatus.NoRepo}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>{errorMessages.noRepo}</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.Error}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1} gap={1}>
          <text fg={sk.error} selectable={false}>{props.state.error ?? errorMessages.unknown}</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.Ok && props.state.prs.length === 0}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>{errorMessages.noBranchPRs}</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.Ok && props.state.prs.length > 0}>
        <box flexDirection="column" gap={1} paddingTop={0}>
          <For each={props.state.prs}>
            {(pr, i) => (
              <PRRow
                pr={pr}
                onClick={() => {
                  props.setSelectedIdx(i())
                  props.onOpen(pr.number)
                }}
                text={sk.text}
                muted={sk.muted}
                pass={sk.success}
                fail={sk.error}
                warn={sk.warning}
                merged={sk.merged}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
