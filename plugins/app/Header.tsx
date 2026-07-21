/** @jsxImportSource @opentui/solid */

export function Header(props: {
  expanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={0}
      paddingRight={1}
      onMouseUp={() => props.onToggleExpand()}
    >
      <text>{props.expanded ? "▼" : "▶"}</text>
      <text>
        <b>PRs</b>
      </text>
    </box>
  )
}
