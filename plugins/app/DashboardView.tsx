/** @jsxImportSource @opentui/solid */
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { BoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  DashboardStatus,
  type DashboardState,
  type PRScope,
  type PRStatusFilter,
} from "../domain/types"
import { filterPRs } from "../domain/pr-filters"
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
  scope: PRScope
  statusFilter: PRStatusFilter
  onCycleScope: () => void
  onCycleStatus: () => void
}) {
  const sk = skin(props.theme)
  const [scopeHovered, setScopeHovered] = createSignal(false)
  const [statusHovered, setStatusHovered] = createSignal(false)
  let view: BoxRenderable | undefined
  const [titleWidth, setTitleWidth] = createSignal(48)
  const renderer = useRenderer()
  onMount(() => {
    const updateTitleWidth = () => {
      if (!view) return
      const nextWidth = Math.max(1, Math.floor(view.width) - 2)
      setTitleWidth((current) => current === nextWidth ? current : nextWidth)
    }
    renderer.on("frame", updateTitleWidth)
    renderer.on("resize", updateTitleWidth)
    onCleanup(() => {
      renderer.off("frame", updateTitleWidth)
      renderer.off("resize", updateTitleWidth)
    })
  })

  const prs = () => filterPRs(
    props.state.prs,
    props.scope,
    props.statusFilter,
    props.state.currentBranch,
    props.state.viewerLogin,
  )
  return (
    <box ref={(element) => { view = element }} flexDirection="column" paddingTop={1} paddingBottom={1} gap={0} width="100%">
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
        <box flexGrow={1}></box>
        <box flexDirection="row" gap={2}>
          <text
            fg={scopeHovered() ? sk.text : sk.muted}
            selectable={false}
            onMouseOver={() => setScopeHovered(true)}
            onMouseOut={() => setScopeHovered(false)}
            onMouseUp={() => props.onCycleScope()}
          >
            {` ${props.scope}`}
          </text>
          <text
            fg={statusHovered() ? sk.text : sk.muted}
            selectable={false}
            onMouseOver={() => setStatusHovered(true)}
            onMouseOut={() => setStatusHovered(false)}
            onMouseUp={() => props.onCycleStatus()}
          >
            {` ${props.statusFilter}`}
          </text>
        </box>
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

      <Show when={props.state.status === DashboardStatus.Ok && prs().length === 0}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>{errorMessages.noMatchingPRs}</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.Ok && prs().length > 0}>
        <box flexDirection="column" gap={1} paddingTop={1} width="100%">
          <For each={prs()}>
            {(pr, i) => (
              <PRRow
                pr={pr}
                titleWidth={titleWidth()}
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
