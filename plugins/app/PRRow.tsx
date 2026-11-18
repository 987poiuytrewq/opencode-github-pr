/** @jsxImportSource @opentui/solid */
import type { PR } from "../domain/types"
import { truncateTitle } from "../domain/format"
import {
  checkStatusGroups,
  commentThreadCounts,
  reviewStatusGroups,
  type StatusCategory,
} from "../domain/pr-status"
import { For, Show } from "solid-js"

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

export function PRRow(props: {
  pr: PR
  titleWidth: number
  onClick: () => void
  text: string
  muted: string
  pass: string
  fail: string
  warn: string
  merged: string
}) {
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
  const commentStatuses = comments
    ? [
        ...(comments.open > 0 ? [{ icon: OPEN_COMMENT_ICON, count: comments.open }] : []),
        ...(comments.resolved > 0 ? [{ icon: RESOLVED_COMMENT_ICON, count: comments.resolved }] : []),
      ]
    : []

  return (
    <box
      flexDirection="column"
      width="100%"
      paddingLeft={0}
      paddingRight={0}
      onMouseUp={() => props.onClick()}
    >
      <box flexDirection="row" gap={1} width="100%">
        <text fg={iconColor} selectable={false}>{icon}</text>
        <text fg={props.text} selectable={false} height={1} wrapMode="none">
          {title()}
        </text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={props.muted} selectable={false}>{`#${props.pr.number}`}</text>
        <text fg={props.pass} selectable={false}>{`+${props.pr.additions}`}</text>
        <text fg={props.fail} selectable={false}>{`-${props.pr.deletions}`}</text>
        <box flexGrow={1}></box>
        <Show when={commentStatuses.length > 0}>
          <For each={commentStatuses}>
            {(comment) => (
              <text fg={props.muted} selectable={false}>{`${comment.icon}${comment.count}`}</text>
            )}
          </For>
        </Show>
        <For each={reviews}>
          {(group) => (
            <text fg={statusColor(group.status, props)} selectable={false}>
              {`${REVIEW_ICON}${reviews.length > 1 ? group.count : ""}`}
            </text>
          )}
        </For>
        <For each={checks}>
          {(group) => (
            <text fg={statusColor(group.status, props)} selectable={false}>
              {`●${checks.length > 1 ? group.count : ""}`}
            </text>
          )}
        </For>
      </box>
    </box>
  )
}
