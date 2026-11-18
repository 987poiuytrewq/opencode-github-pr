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
import { filterPRs } from "../domain/pr-filters"
import { skin } from "./theme"
import { errorMessages } from "../domain/messages"
import { PRRow } from "./PRRow"

const PAGE_SIZE = 5

export function DashboardView(props: {
  theme: ResolvedTheme
  state: DashboardState
  setSelectedIdx: (n: number) => void
  onOpen: (n: number, target?: PRLinkTarget) => void
  scope: PRScope
  statusFilter: PRStatusFilter
  onCycleScope: () => void
  onCycleStatus: () => void
}) {
  const sk = skin(props.theme)
  const [scopeHovered, setScopeHovered] = createSignal(false)
  const [statusHovered, setStatusHovered] = createSignal(false)
  const [page, setPage] = createSignal(0)
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

  const prs = () => filterPRs(
    props.state.prs,
    props.scope,
    props.statusFilter,
    props.state.currentBranch,
    props.state.viewerLogin,
  )
  const pageCount = () => Math.max(1, Math.ceil(prs().length / PAGE_SIZE))
  const currentPage = () => Math.min(page(), pageCount() - 1)
  const pagePRs = () =>
    prs().slice(currentPage() * PAGE_SIZE, (currentPage() + 1) * PAGE_SIZE)
  const canGoPrevious = () => currentPage() > 0
  const canGoNext = () => currentPage() < pageCount() - 1
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

      <Show when={props.state.status === DashboardStatus.Loading}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}>󰔟 Loading PRs</text>
          <text fg={sk.muted} selectable={false}>  Checking GitHub…</text>
        </box>
      </Show>

      <Show when={props.state.listingTruncated}>
        <box paddingLeft={1}>
          <text fg={sk.warning}>Showing first 300 PRs; more are available</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.NoRepo}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.muted} selectable={false}> No GitHub repo</text>
          <text fg={sk.muted} selectable={false}>  Add an origin remote or switch to the right project.</text>
        </box>
      </Show>

      <Show when={props.state.status === DashboardStatus.Error}>
        <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1}>
          <text fg={sk.error} selectable={false}> {errorPresentation().title}</text>
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
          <text fg={sk.muted} selectable={false}> {errorMessages.noMatchingPRs}</text>
          <text fg={sk.muted} selectable={false}>  Try a different scope or status.</text>
        </box>
      </Show>

      <Show when={listIsAvailable() && prs().length > 0}>
        <box flexDirection="column" gap={0} width="100%">
          <box flexDirection="column" gap={1} paddingTop={1} width="100%">
            <For each={pagePRs()}>
              {(pr, i) => (
                <PRRow
                  pr={pr}
                  titleWidth={titleWidth()}
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
