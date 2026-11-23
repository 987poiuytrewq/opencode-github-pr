/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { PR, PRLinkTarget } from "../domain/types"
import { truncateTitle } from "../domain/format"
import {
  checkStatusGroups,
  commentThreadCounts,
  mergeReadiness,
  reviewStatusGroups,
  type StatusCategory,
} from "../domain/pr-status"
import type { DashboardSpacing, StatusIndicatorStyle, StatusIndicatorStyles } from "./config"

function statusColor(status: StatusCategory, props: {
  pass: string
  fail: string
  warn: string
  muted: string
}): string {
  return {
    pass: props.pass,
    fail: props.fail,
    pending: props.warn,
    neutral: props.muted,
    none: props.muted,
  }[status]
}

const statusSeverity: Record<StatusCategory, number> = {
  none: 0,
  pass: 1,
  neutral: 2,
  pending: 3,
  fail: 4,
}

function displayedGroups(
  groups: Array<{ status: StatusCategory; count: number }>,
  style: StatusIndicatorStyle,
) {
  if (style !== "merged" || groups.length === 0) return groups
  const worst = groups.reduce((current, group) =>
    statusSeverity[group.status] > statusSeverity[current.status] ? group : current,
  )
  return [worst]
}

function indicatorPresentation(
  groups: Array<{ status: StatusCategory; count: number }>,
  group: { status: StatusCategory; count: number },
  style: StatusIndicatorStyle,
  showSingleStatusCount: boolean,
  repeatCap: number,
): { iconCount: number; count?: number } {
  if (style === "repeat") {
    return group.count > repeatCap
      ? { iconCount: 1, count: group.count }
      : { iconCount: Math.max(1, group.count) }
  }
  return {
    iconCount: 1,
    count: style === "count" &&
        (groups.length > 1 || (showSingleStatusCount && group.count > 0))
      ? group.count
      : undefined,
  }
}

function ClickableText(props: {
  label: string
  color: string
  target: PRLinkTarget
  onClick: (target: PRLinkTarget) => void
}) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <text
      fg={props.color}
      selectable={false}
      onMouseOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onMouseOut={(event) => {
        event.stopPropagation()
        setHovered(false)
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
        props.onClick(props.target)
      }}
    >
      {hovered() ? <u>{props.label}</u> : props.label}
    </text>
  )
}

function ClickableIndicator(props: {
  icon: string
  count?: number | string
  gap: number
  color: string
  target: PRLinkTarget
  onClick: (target: PRLinkTarget) => void
}) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexDirection="row"
      gap={props.count === undefined ? 0 : props.gap}
      onMouseOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onMouseOut={(event) => {
        event.stopPropagation()
        setHovered(false)
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
        props.onClick(props.target)
      }}
    >
      <text fg={props.color} selectable={false}>
        {hovered() ? <u>{props.icon}</u> : props.icon}
      </text>
      <Show when={props.count !== undefined}>
        <text fg={props.color} selectable={false}>
          {hovered() ? <u>{props.count}</u> : props.count}
        </text>
      </Show>
    </box>
  )
}

export function PRRow(props: {
  pr: PR
  titleWidth: number
  secondaryBackground: string
  onClick: (target: PRLinkTarget) => void
  text: string
  muted: string
  pass: string
  fail: string
  warn: string
  draft: string
  merged: string
  icons: {
    openPR: string
    closedPR: string
    draftPR: string
    mergedPR: string
    review: string
    openComment: string
    check: string
  }
  spacing: DashboardSpacing
  showSingleStatusCount: boolean
  statusIndicatorStyles: StatusIndicatorStyles
  statusIndicatorRepeatCap: number
}) {
  const [titleHovered, setTitleHovered] = createSignal(false)
  const title = () => truncateTitle(props.pr.title, props.titleWidth)
  const icon = () => props.pr.isMerged
    ? props.icons.mergedPR
    : props.pr.isDraft
      ? props.icons.draftPR
      : props.pr.isClosed
        ? props.icons.closedPR
        : props.icons.openPR
  const iconColor = () => props.pr.isMerged
    ? props.merged
    : props.pr.isDraft
      ? props.draft
      : statusColor(mergeReadiness(props.pr), props)
  const checks = () => checkStatusGroups(props.pr)
  const reviews = () => reviewStatusGroups(props.pr)
  const comments = () => commentThreadCounts(props.pr)
  const commentStatuses = () => {
    const commentCounts = comments()
    const open = commentCounts?.open
    return open
      ? [{
        icon: props.icons.openComment,
        count: `${open}${commentCounts.truncated ? "+" : ""}`,
        repeatCount: open,
      }]
      : []
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      paddingLeft={0}
      paddingRight={0}
    >
      <box
        flexDirection="row"
        gap={1}
        width="100%"
        onMouseOver={() => setTitleHovered(true)}
        onMouseOut={() => setTitleHovered(false)}
        onMouseUp={() => props.onClick("overview")}
      >
        <ClickableText
          label={icon()}
          color={iconColor()}
          target="mergeStatus"
          onClick={props.onClick}
        />
        <text fg={props.text} selectable={false} height={1} wrapMode="none">
          {titleHovered() ? <u>{title()}</u> : title()}
        </text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2} width="100%" backgroundColor={props.secondaryBackground}>
        <ClickableText
          label={`#${props.pr.number}`}
          color={props.muted}
          target="overview"
          onClick={props.onClick}
        />
        <ClickableText
          label={`+${props.pr.additions}`}
          color={props.pass}
          target="files"
          onClick={props.onClick}
        />
        <ClickableText
          label={`-${props.pr.deletions}`}
          color={props.fail}
          target="files"
          onClick={props.onClick}
        />
        <box flexGrow={1}></box>
        <box flexDirection="row" gap={props.spacing.differentTypeGroups}>
          <Show when={commentStatuses().length > 0}>
            <For each={commentStatuses()}>
              {(comment) => {
                const style = props.statusIndicatorStyles.comments
                const isRepeated = style === "repeat" &&
                  comment.repeatCount <= props.statusIndicatorRepeatCap
                const count = style === "count" ||
                    (style === "repeat" && !isRepeated)
                  ? comment.count
                  : undefined
                return (
                  <ClickableIndicator
                    icon={comment.icon.repeat(isRepeated ? comment.repeatCount : 1)}
                    count={count}
                    gap={props.spacing.iconToCount}
                    color={props.muted}
                    target="files"
                    onClick={props.onClick}
                  />
                )
              }}
            </For>
          </Show>
          <Show when={reviews().length > 0}>
            <box flexDirection="row" gap={props.spacing.sameTypeGroups}>
              <For each={displayedGroups(reviews(), props.statusIndicatorStyles.reviews)}>
                {(group) => {
                  const presentation = indicatorPresentation(
                    reviews(),
                    group,
                    props.statusIndicatorStyles.reviews,
                    props.showSingleStatusCount,
                    props.statusIndicatorRepeatCap,
                  )
                  return (
                    <ClickableIndicator
                      icon={props.icons.review.repeat(presentation.iconCount)}
                      count={presentation.count}
                      gap={props.spacing.iconToCount}
                      color={statusColor(group.status, props)}
                      target="overview"
                      onClick={props.onClick}
                    />
                  )
                }}
              </For>
            </box>
          </Show>
          <box flexDirection="row" gap={props.spacing.sameTypeGroups}>
            <For each={displayedGroups(checks(), props.statusIndicatorStyles.checks)}>
              {(group) => {
                const presentation = indicatorPresentation(
                  checks(),
                  group,
                  props.statusIndicatorStyles.checks,
                  props.showSingleStatusCount,
                  props.statusIndicatorRepeatCap,
                )
                return (
                  <ClickableIndicator
                    icon={props.icons.check.repeat(presentation.iconCount)}
                    count={presentation.count}
                    gap={props.spacing.iconToCount}
                    color={statusColor(group.status, props)}
                    target="checks"
                    onClick={props.onClick}
                  />
                )
              }}
            </For>
          </box>
        </box>
      </box>
    </box>
  )
}
