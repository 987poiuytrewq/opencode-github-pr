/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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
import { skin, type Skin } from "./theme"
import { errorMessages } from "../domain/messages"
import { PRRow } from "./PRRow"
import type { DashboardIcons, DashboardSpacing } from "./config"
import { StatusMessage } from "./StatusMessage"

export function DashboardView(props: {
  theme: ResolvedTheme
  state: DashboardState
  setSelectedIdx: (n: number) => void
  onOpen: (n: number, target?: PRLinkTarget) => void
  scope: PRScope
  statusFilter: PRStatusFilter
  onCycleScope: () => void
  onCycleStatus: () => void
  onLoadMore: () => Promise<void>
  pageSize: number
  colors: Partial<Skin>
  icons: DashboardIcons
  spacing: DashboardSpacing
  showSingleStatusCount: boolean
}) {
  const sk = createMemo(() => skin(props.theme, props.colors))
  const [scopeHovered, setScopeHovered] = createSignal(false)
  const [statusHovered, setStatusHovered] = createSignal(false)
  const [page, setPage] = createSignal(0)
  const [previousHovered, setPreviousHovered] = createSignal(false)
  const [nextHovered, setNextHovered] = createSignal(false)
  let view: BoxRenderable | undefined
  const [titleWidth, setTitleWidth] = createSignal(48)
  const renderer = useRenderer()
  createEffect(() => {
    props.statusFilter
    props.scope
    setPage(0)
  })
  onMount(() => {
    const iconWidth = Math.max(
      Bun.stringWidth(props.icons.openPR),
      Bun.stringWidth(props.icons.closedPR),
      Bun.stringWidth(props.icons.draftPR),
      Bun.stringWidth(props.icons.mergedPR),
    )
    const updateTitleWidth = () => {
      const measuredWidth = view?.width
      const availableWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : renderer.width
      if (availableWidth <= 0) return
      const nextWidth = Math.max(1, Math.floor(availableWidth) - iconWidth - 1)
      setTitleWidth((current) => current === nextWidth ? current : nextWidth)
    }
    updateTitleWidth()
    const needsPostLayoutMeasurement = !view || view.width <= 0
    if (needsPostLayoutMeasurement) renderer.once("frame", updateTitleWidth)
    view?.on("resize", updateTitleWidth)
    renderer.on("resize", updateTitleWidth)
    onCleanup(() => {
      renderer.off("frame", updateTitleWidth)
      view?.off("resize", updateTitleWidth)
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
  const pageCount = () => Math.max(1, Math.ceil(prs().length / props.pageSize))
  const totalPageCount = () => {
    const totalCount = props.state.pagination.totalCount
    return totalCount === null ? null : Math.max(1, Math.ceil(totalCount / props.pageSize))
  }
  const currentPage = () => Math.min(page(), pageCount() - 1)
  const pagePRs = () =>
    prs().slice(currentPage() * props.pageSize, (currentPage() + 1) * props.pageSize)
  const filtersMatch = () =>
    props.state.pagination.listing === props.statusFilter &&
    props.state.pagination.scope === props.scope &&
    props.state.pagination.scopeValue === (props.scope === "branch" ? props.state.currentBranch : null)
  const canGoPrevious = () => currentPage() > 0
  const canGoNext = () =>
    currentPage() < pageCount() - 1 ||
    (filtersMatch() &&
      props.state.pagination.hasMore &&
      !props.state.pagination.loading)
  const listIsAvailable = () =>
    props.state.status === DashboardStatus.Ok ||
    (props.state.status === DashboardStatus.Error && props.state.prs.length > 0)
  const listingPending = () => !filtersMatch()
  const scopeListingPending = () =>
    props.state.pagination.scope !== props.scope ||
    props.state.pagination.scopeValue !== (props.scope === "branch" ? props.state.currentBranch : null)

  const goNext = async () => {
    if (currentPage() < pageCount() - 1) {
      const next = currentPage() + 1
      setPage(next)
      if (
        filtersMatch() &&
        props.state.pagination.hasMore
      ) void props.onLoadMore()
      return
    }
    if (
      !filtersMatch() ||
      !props.state.pagination.hasMore ||
      props.state.pagination.loading
    ) return

    const previousPage = currentPage()
    await props.onLoadMore()
    if (pageCount() > previousPage + 1) setPage(previousPage + 1)
  }

  const errorPresentation = (): { title: string; description: string } => {
    const detail = props.state.error ?? errorMessages.unknown
    const kind: PRListErrorKind = props.state.errorKind ?? "unknown"
    switch (kind) {
      case "authentication":
        return {
          title: "GitHub sign-in failed",
          description: "Run gh auth login or set GITHUB_TOKEN or GH_TOKEN.",
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
      paddingBottom={1}
      gap={0}
      width="100%"
    >
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={0}
        paddingRight={0}
      >
        <text fg={sk().text}>
          <b>Pull Requests</b>
        </text>
        <box flexGrow={1}></box>
        <box flexDirection="row" gap={1}>
          <box
            flexDirection="row"
            gap={1}
            onMouseOver={() => setScopeHovered(true)}
            onMouseOut={() => setScopeHovered(false)}
            onMouseUp={() => props.onCycleScope()}
          >
            <Show when={props.icons.scope}>
              <text fg={sk().muted} selectable={false}>{props.icons.scope}</text>
            </Show>
            <text fg={scopeHovered() ? sk().accent : sk().muted} selectable={false}>
              {props.scope}
            </text>
          </box>
          <text
            fg={statusHovered() ? sk().accent : sk().muted}
            selectable={false}
            onMouseOver={() => setStatusHovered(true)}
            onMouseOut={() => setStatusHovered(false)}
            onMouseUp={() => props.onCycleStatus()}
          >
            {props.statusFilter}
          </text>
        </box>
      </box>

      <Show when={props.state.status === DashboardStatus.Loading}>
        <StatusMessage
          icon={props.icons.loading}
          title="Loading PRs"
          titleColor={sk().muted}
          descriptionColor={sk().muted}
        />
      </Show>

      <Show when={listingPending() && props.state.status !== DashboardStatus.Loading}>
        <StatusMessage
          icon={props.icons.loading}
          title={scopeListingPending() ? `Loading ${props.scope} PRs` : "Loading PRs"}
          titleColor={sk().muted}
          descriptionColor={sk().muted}
        />
      </Show>

      <Show when={props.state.status === DashboardStatus.NoRepo}>
        <StatusMessage
          icon={props.icons.info}
          title="No GitHub repo"
          description="Add a GitHub remote or switch to the right project."
          titleColor={sk().muted}
          descriptionColor={sk().muted}
        />
      </Show>

      <Show when={props.state.status === DashboardStatus.Error}>
        <StatusMessage
          icon={props.icons.error}
          title={errorPresentation().title}
          description={errorPresentation().description}
          titleColor={sk().error}
          descriptionColor={sk().muted}
        />
      </Show>

      <Show
        when={
          listIsAvailable() &&
          !listingPending() &&
          filtersMatch() &&
          prs().length === 0 &&
          (props.state.status === DashboardStatus.Ok || props.state.prs.length > 0)
        }
      >
        <StatusMessage
          icon={props.icons.info}
          title={errorMessages.noMatchingPRs}
          titleColor={sk().muted}
          descriptionColor={sk().muted}
        />
      </Show>

      <Show when={listIsAvailable() && filtersMatch() && prs().length > 0}>
        <box flexDirection="column" gap={0} width="100%">
          <box flexDirection="column" gap={1} paddingTop={1} width="100%">
            <For each={pagePRs()}>
              {(pr, i) => (
                <PRRow
                  pr={pr}
                  titleWidth={titleWidth()}
                  secondaryBackground={sk().panelAlt}
                  onClick={(target) => {
                    props.setSelectedIdx(currentPage() * props.pageSize + i())
                    props.onOpen(pr.number, target)
                  }}
                  text={sk().text}
                  muted={sk().muted}
                  pass={sk().success}
                  fail={sk().error}
                  warn={sk().warning}
                  draft={sk().draft}
                  merged={sk().merged}
                  icons={props.icons}
                  spacing={props.spacing}
                  showSingleStatusCount={props.showSingleStatusCount}
                />
              )}
            </For>
          </box>
          <Show when={pageCount() > 1 || (filtersMatch() && props.state.pagination.hasMore)}>
            <box
              flexDirection="row"
              justifyContent="flex-end"
              gap={1}
              paddingTop={1}
              paddingRight={1}
              width="100%"
            >
              <box
                width={Bun.stringWidth(props.icons.previousPage) + 2}
                marginLeft={-1}
                marginRight={-1}
                flexDirection="row"
                justifyContent="center"
                alignItems="center"
                onMouseOver={() => canGoPrevious() && setPreviousHovered(true)}
                onMouseOut={() => setPreviousHovered(false)}
                onMouseUp={() => canGoPrevious() && setPage(currentPage() - 1)}
              >
                <text
                  fg={canGoPrevious() && previousHovered() ? sk().accent : sk().muted}
                  selectable={false}
                >
                  {props.icons.previousPage}
                </text>
              </box>
              <text fg={sk().muted} selectable={false}>
                {`${currentPage() + 1} of ${totalPageCount() ?? pageCount()}${totalPageCount() === null && filtersMatch() && props.state.pagination.hasMore ? "+" : ""}`}
              </text>
              <box
                width={Bun.stringWidth(props.icons.nextPage) + 2}
                marginLeft={-1}
                marginRight={-1}
                flexDirection="row"
                justifyContent="center"
                alignItems="center"
                onMouseOver={() => canGoNext() && setNextHovered(true)}
                onMouseOut={() => setNextHovered(false)}
                onMouseUp={() => canGoNext() && void goNext()}
              >
                <text
                  fg={canGoNext() && nextHovered() ? sk().accent : sk().muted}
                  selectable={false}
                >
                  {props.icons.nextPage}
                </text>
              </box>
            </box>
          </Show>
          <Show when={filtersMatch() && props.state.pagination.limitReached}>
            <StatusMessage
              icon={props.icons.info}
              title="GitHub search is limited to 1,000 matching PRs"
              titleColor={sk().muted}
              descriptionColor={sk().muted}
            />
          </Show>
        </box>
      </Show>
    </box>
  )
}
