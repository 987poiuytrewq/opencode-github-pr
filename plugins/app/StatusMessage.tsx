/** @jsxImportSource @opentui/solid */

export function StatusMessage(props: {
  icon: string
  title: string
  description: string
  titleColor: string
  descriptionColor: string
}) {
  const descriptionIndent = Bun.stringWidth(props.icon) + 1

  return (
    <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1} width="100%">
      <text fg={props.titleColor} selectable={false}>{props.icon} {props.title}</text>
      <box paddingLeft={descriptionIndent} width="100%">
        <text fg={props.descriptionColor} selectable={false}>{props.description}</text>
      </box>
    </box>
  )
}
