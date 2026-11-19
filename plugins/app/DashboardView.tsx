/** @jsxImportSource @opentui/solid */
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { BoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  DashboardStatus,
  type DashboardState,
  type PRLinkTarget,
  type PRListErrorKind,
  type PRScope,
  type PRStatusFilter,
} from "../domain/types"
import { SEARCH_RESULT_LIMIT } from "../domain/pr-filters"
import { skin, type Skin } from "./theme"
import { errorMessages } from "../domain/messages"
import { PRRow } from "./PRRow"
import type { DashboardIcons } from "./config"

export function DashboardView(props: {
  theme: ResolvedTheme
  state: DashboardState
  setSelectedIdx: (n: number) => void
  onOpen: (n: number, target?: PRLinkTarget) => void
  scope: PRScope
  statusFilter: PRStatusFilter
  onCycleScope: () => void
  onCycleStatus: () => void
  onPageChange: (page: number) => void
  pageSize: number
  colors: Partial<Skin>
  icons: DashboardIcons
}) {
  const sk = skin(props.theme, props.colors)
  const [scopeHovered, setScopeHovered] = createSignal(false)
  const [statusHovered, setStatusHovered] = createSignal(false)
  const [previousHovered, setPreviousHovered] = createSignal(false)
  const [nextHovered, setNextHovered] = createSignal(false)
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

  // The state holds one page of results; GitHub did the filtering.
  const prs = () => props.state.prs
  const currentPage = () => props.state.page
  const pageCount = () =>
    Math.max(currentPage() + 1, Math.ceil(Math.min(props.state.totalCount, SEARCH_RESULT_LIMIT) / props.pageSize))
  const canGoPrevious = () => currentPage() > 0
  const canGoNext = () => props.state.hasNextPage && currentPage() < pageCount() - 1
  const listIsAvailable = () =>
    props.state.status === DashboardStatus.Ok ||
    (props.state.status === DashboardStatus.Error && props.state.prs.length > 0)

  const errorPresentation = (): { title: string; description: string } => {
    const detail = props.state.error ?? errorMessages.unknown
    const kind: PRListErrorKind = props.state.errorKind ?? "unknown"
    switch (kind) {
      case "authentication":
        return {
          title: "GitHub sign-in failed",
          description: "Set GITHUB_TOKEN or GH_TOKEN.",
        }
      case "forbidden":
        return {
          title: "Permission denied",
          description: "Give your token read access to this repo.",
        }
      case "rate-limit":
        const retryAt = /(?:resets at|try again at)\s+(.+?)(?:\.)?$/i.exec(detail)?.[1]
        return {
          title: "Rate limit exceeded",
          description: retryAt ? `Try again at ${retryAt.replace(/\.$/, "")}.` : "Wait a little, then try again.",
        }
      case "not-found":
        return {
          title: "Repo not found",
          description: "Check the URL and your access.",
        }
      case "invalid-query":
        return {
          title: "Invalid request",
          description: "Update the plugin, then refresh.",
        }
      case "timeout":
        return {
          title: "Request timed out",
          description: "Try again. Check your connection if it keeps happening.",
        }
      case "network":
        return {
          title: "Cannot reach GitHub",
          description: "Check your internet connection and try again.",
        }
      case "server":
        return {
          title: "GitHub is unavailable",
          description: "Try again in a moment.",
        }
      case "unknown":
        return {
          title: "Couldn't load PRs",
          description: `Try again. Details: ${detail}`,
        }
    }
  }

  return (
    <box
      ref={(element) => { view = element }}
      flexDirection="column"
      paddingTop={1}
      paddingBottom={1}
      gap={0}
      width="100%"
      backgroundColor={sk.panel}
    >
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={0}
        paddingRight={0}
      >
        <text fg={sk.text}>
          <b>Pull Requests</b>
        </text>
        <box flexGrow={1}></box>
        <box flexDirection="row" gap={2}>
          <text
            fg={scopeHovered() ? sk.accent : sk.muted}
            selectable={false}
            onMouseOver={() => setScopeHovered(true)}
            onMouseOut={() => setScopeHovered(false)}
            onMouseUp={() => props.onCycleScope()}
          >
            {`${props.icons.scope} ${props.scope}`}
          </text>
          <text
            fg={statusHovered() ? sk.accent : sk.muted}
            selectable={false}
            onMouseOver={() => setStatusHovered(true)}
            onMouseOut={() => setStatusHovered(false)}
            onMouseUp={() => props.onCycleStatus()}
          >
            {`${props.icons.status} ${props.statusFilter}`}
          </text>
        </box>
      </box>

      <Show when={props.state.status === DashboardStatus.Loading}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>{props.icons.loading} Loading PRs</text>
          <text fg={sk.muted} selectable={false}>  Checking GitHub…</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.NoRepo}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>{props.icons.info} No GitHub repo</text>
          <text fg={sk.muted} selectable={false}>  Add a GitHub remote or switch to the right project.</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.Error}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.error} selectable={false}>{props.icons.error} {errorPresentation().title}</text>
          <text fg={sk.muted} selectable={false}>  {errorPresentation().description}</text>
        </box>
      </Show>

      <Show
        when={
          listIsAvailable() &&
          prs().length === 0 &&
          (props.state.status === DashboardStatus.Ok || props.state.prs.length > 0)
        }
      >
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>{props.icons.info} {errorMessages.noMatchingPRs}</text>
          <text fg={sk.muted} selectable={false}>  Try a different scope or status.</text>
        </box>
      </Show>

      <Show when={listIsAvailable() && prs().length > 0}>
        <box flexDirection="column" gap={0} width="100%">
          <box flexDirection="column" gap={1} paddingTop={1} width="100%">
            <For each={prs()}>
              {(pr, i) => (
                <PRRow
                  pr={pr}
                  titleWidth={titleWidth()}
                  secondaryBackground={sk.panelAlt}
                  onClick={(target) => {
                    props.setSelectedIdx(i())
                    props.onOpen(pr.number, target)
                  }}
                  text={sk.text}
                  muted={sk.muted}
                  pass={sk.success}
                  fail={sk.error}
                  warn={sk.warning}
                  draft={sk.draft}
                  merged={sk.merged}
                  icons={props.icons}
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
              border={["top"]}
              borderColor={previousHovered() || nextHovered() ? sk.borderActive : sk.border}
            >
              <text
                fg={canGoPrevious() && previousHovered() ? sk.accent : sk.muted}
                selectable={false}
                onMouseOver={() => canGoPrevious() && setPreviousHovered(true)}
                onMouseOut={() => setPreviousHovered(false)}
                onMouseUp={() => canGoPrevious() && props.onPageChange(currentPage() - 1)}
              >
                {props.icons.previousPage}
              </text>
              <text fg={sk.muted} selectable={false}>{`${currentPage() + 1} of ${pageCount()}`}</text>
              <text
                fg={canGoNext() && nextHovered() ? sk.accent : sk.muted}
                selectable={false}
                onMouseOver={() => canGoNext() && setNextHovered(true)}
                onMouseOut={() => setNextHovered(false)}
                onMouseUp={() => canGoNext() && props.onPageChange(currentPage() + 1)}
              >
                {props.icons.nextPage}
              </text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
