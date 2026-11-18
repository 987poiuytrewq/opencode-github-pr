/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { PR, PRLinkTarget } from "../domain/types"
import { truncateTitle } from "../domain/format"
import {
  classifyCI,
  commentThreadCounts,
  reviewStatusGroups,
  type StatusCategory,
} from "../domain/pr-status"

const OPEN_PR_ICON = ""
const MERGED_PR_ICON = ""
const REVIEW_ICON = ""
const OPEN_COMMENT_ICON = "󰅺"
const RESOLVED_COMMENT_ICON = ""

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
    <box
      flexDirection="row"
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        props.onClick(props.target)
      }}
    >
      <text fg={props.color} selectable={false}>
        {hovered() ? <u>{props.label}</u> : props.label}
      </text>
    </box>
  )
}

export function PRRow(props: {
  pr: PR
  onClick: (target: PRLinkTarget) => void
  text: string
  muted: string
  pass: string
  fail: string
  warn: string
  merged: string
}) {
  const title = truncateTitle(props.pr.title, String(props.pr.number).length + 1)
  const icon = props.pr.isMerged ? MERGED_PR_ICON : OPEN_PR_ICON
  const iconColor = props.pr.isMerged
    ? props.merged
    : props.pr.mergeable === "MERGEABLE"
      ? props.pass
      : props.pr.mergeable === "CONFLICTING"
        ? props.fail
        : props.muted
  const ci = classifyCI(props.pr)
  const ciColor = {
    pass: props.pass,
    fail: props.fail,
    pending: props.warn,
    none: props.muted,
  }[ci]
  const reviews = reviewStatusGroups(props.pr)
  const comments = commentThreadCounts(props.pr)
  const commentStatuses = comments
    ? [
        ...(comments.open > 0 ? [{ icon: OPEN_COMMENT_ICON, count: comments.open }] : []),
        ...(comments.resolved > 0
          ? [{ icon: RESOLVED_COMMENT_ICON, count: comments.resolved }]
          : []),
      ]
    : []

  return (
    <box
      flexDirection="column"
      paddingLeft={0}
      paddingRight={1}
      onMouseUp={() => props.onClick("overview")}
    >
      <box flexDirection="row" gap={1}>
        <ClickableText
          label={icon}
          color={iconColor}
          target="mergeStatus"
          onClick={props.onClick}
        />
        <ClickableText
          label={title}
          color={props.text}
          target="overview"
          onClick={props.onClick}
        />
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
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
        <ClickableText
          label="●"
          color={ciColor}
          target="checks"
          onClick={props.onClick}
        />
      </box>
    </box>
  )
}
