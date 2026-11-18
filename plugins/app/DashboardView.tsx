/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { DashboardStatus, type DashboardState, type PRLinkTarget } from "../domain/types"
import { skin } from "./theme"
import { errorMessages } from "../domain/messages"
import { PRRow } from "./PRRow"

const PAGE_SIZE = 5

export function DashboardView(props: {
  theme: ResolvedTheme
  state: DashboardState
  onRefresh: () => void
  selectedIdx: number
  setSelectedIdx: (n: number) => void
  onOpen: (n: number, target?: PRLinkTarget) => void
  expanded: boolean
  onToggleExpand: () => void
}) {
  const sk = skin(props.theme)
  const [page, setPage] = createSignal(0)
  const [previousHovered, setPreviousHovered] = createSignal(false)
  const [nextHovered, setNextHovered] = createSignal(false)
  const pageCount = () => Math.max(1, Math.ceil(props.state.prs.length / PAGE_SIZE))
  const currentPage = () => Math.min(page(), pageCount() - 1)
  const pagePRs = () =>
    props.state.prs.slice(currentPage() * PAGE_SIZE, (currentPage() + 1) * PAGE_SIZE)
  const canGoPrevious = () => currentPage() > 0
  const canGoNext = () => currentPage() < pageCount() - 1

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0} width="100%">
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={0}
        paddingRight={0}
        onMouseUp={() => props.onToggleExpand()}
      >
        <text fg={sk.text}>{props.expanded ? "▼" : "▶"}</text>
        <text fg={sk.text}>
          <b>Changes</b>
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

      <Show when={props.expanded && props.state.status === DashboardStatus.Ok && props.state.prs.length === 0}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>{errorMessages.noBranchPRs}</text>
        </box>
      </Show>

      <Show when={props.expanded && props.state.status === DashboardStatus.Ok && props.state.prs.length > 0}>
        <box flexDirection="column" gap={0} width="100%">
          <box flexDirection="column" gap={1} paddingTop={0} width="100%">
            <For each={pagePRs()}>
              {(pr, i) => (
                <PRRow
                  pr={pr}
                  onClick={(target) => {
                    props.setSelectedIdx(currentPage() * PAGE_SIZE + i())
                    props.onOpen(pr.number, target)
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
          <Show when={pageCount() > 1}>
            <box
              flexDirection="row"
              justifyContent="flex-end"
              gap={1}
              paddingTop={1}
              width="100%"
            >
              <text
                fg={canGoPrevious() && previousHovered() ? sk.text : sk.muted}
                selectable={false}
                onMouseOver={() => canGoPrevious() && setPreviousHovered(true)}
                onMouseOut={() => setPreviousHovered(false)}
                onMouseUp={() => canGoPrevious() && setPage(currentPage() - 1)}
              >
                
              </text>
              <text fg={sk.muted} selectable={false}>{`${currentPage() + 1} of ${pageCount()}`}</text>
              <text
                fg={canGoNext() && nextHovered() ? sk.text : sk.muted}
                selectable={false}
                onMouseOver={() => canGoNext() && setNextHovered(true)}
                onMouseOut={() => setNextHovered(false)}
                onMouseUp={() => canGoNext() && setPage(currentPage() + 1)}
              >
                
              </text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
