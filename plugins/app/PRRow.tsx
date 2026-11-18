/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { PR, PRLinkTarget } from "../domain/types"
import { truncateTitle } from "../domain/format"
import {
  checkStatusGroups,
  commentThreadCounts,
  reviewStatusGroups,
  type StatusCategory,
} from "../domain/pr-status"

const OPEN_PR_ICON = ""
const MERGED_PR_ICON = ""
const REVIEW_ICON = ""
const OPEN_COMMENT_ICON = "󰅺"

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

export function PRRow(props: {
  pr: PR
  titleWidth: number
  onClick: (target: PRLinkTarget) => void
  text: string
  muted: string
  pass: string
  fail: string
  warn: string
  merged: string
}) {
  const [titleHovered, setTitleHovered] = createSignal(false)
  const title = () => truncateTitle(props.pr.title, props.titleWidth)
  const icon = props.pr.isMerged ? MERGED_PR_ICON : OPEN_PR_ICON
  const iconColor = props.pr.isMerged
    ? props.merged
    : props.pr.mergeable === "MERGEABLE"
      ? props.pass
      : props.pr.mergeable === "CONFLICTING"
        ? props.fail
        : props.muted
  const checks = checkStatusGroups(props.pr)
  const reviews = reviewStatusGroups(props.pr)
  const comments = commentThreadCounts(props.pr)
  const commentStatuses = comments?.open
    ? [{ icon: OPEN_COMMENT_ICON, count: comments.open }]
    : []

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
          label={icon}
          color={iconColor}
          target="mergeStatus"
          onClick={props.onClick}
        />
        <text fg={props.text} selectable={false} height={1} wrapMode="none">
          {titleHovered() ? <u>{title()}</u> : title()}
        </text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2} width="100%">
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
        <Show when={commentStatuses.length > 0}>
          <For each={commentStatuses}>
            {(comment) => (
              <ClickableText
                label={`${comment.icon}${comment.count}`}
                color={props.muted}
                target="files"
                onClick={props.onClick}
              />
            )}
          </For>
        </Show>
        <For each={reviews}>
          {(group) => (
            <ClickableText
              label={`${REVIEW_ICON}${reviews.length > 1 ? group.count : ""}`}
              color={statusColor(group.status, props)}
              target="overview"
              onClick={props.onClick}
            />
          )}
        </For>
        <For each={checks}>
          {(group) => (
            <ClickableText
              label={`●${checks.length > 1 ? group.count : ""}`}
              color={statusColor(group.status, props)}
              target="checks"
              onClick={props.onClick}
            />
          )}
        </For>
      </box>
    </box>
  )
}
