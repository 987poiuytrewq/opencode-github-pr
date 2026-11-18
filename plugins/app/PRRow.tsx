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
  onClick: () => void
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
  const checks = checkStatusGroups(props.pr)
  const reviews = reviewStatusGroups(props.pr)
  const comments = commentThreadCounts(props.pr)

  return (
    <box
      flexDirection="column"
      paddingLeft={0}
      paddingRight={1}
      onMouseUp={() => props.onClick()}
    >
      <box flexDirection="row" gap={1}>
        <text fg={iconColor} selectable={false}>{icon}</text>
        <text fg={props.text} selectable={false}>{title}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={props.muted} selectable={false}>{`#${props.pr.number}`}</text>
        <text fg={props.pass} selectable={false}>{`+${props.pr.additions}`}</text>
        <text fg={props.fail} selectable={false}>{`-${props.pr.deletions}`}</text>
        <box flexGrow={1}></box>
        <Show when={comments}>
          {(counts) => (
            <>
              <text fg={props.muted} selectable={false}>{`${OPEN_COMMENT_ICON}${counts().open}`}</text>
              <text fg={props.muted} selectable={false}>{`${RESOLVED_COMMENT_ICON}${counts().resolved}`}</text>
            </>
          )}
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
