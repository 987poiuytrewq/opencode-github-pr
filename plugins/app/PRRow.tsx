/** @jsxImportSource @opentui/solid */
import type { PR } from "../domain/types"
import { truncateTitle } from "../domain/format"
import { classifyCI } from "../domain/pr-status"

const OPEN_PR_ICON = ""
const MERGED_PR_ICON = ""

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
  const ci = classifyCI(props.pr)
  const ciColor = {
    pass: props.pass,
    fail: props.fail,
    pending: props.warn,
    none: props.muted,
  }[ci]

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
        <text fg={ciColor} selectable={false}>●</text>
      </box>
    </box>
  )
}
