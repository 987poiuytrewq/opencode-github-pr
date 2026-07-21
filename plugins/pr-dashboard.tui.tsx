/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api) => {
  const [expanded, setExpanded] = createSignal(true)

  const slots: TuiSlotPlugin = {
    order: 250,
    slots: {
      sidebar_content() {
        return (
          <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0}>
            <box
              flexDirection="row"
              gap={1}
              paddingLeft={0}
              paddingRight={1}
              onMouseUp={() => setExpanded((v) => !v)}
            >
              <text>{expanded() ? "▼" : "▶"}</text>
              <text>
                <b>PRs</b>
              </text>
            </box>
            <Show when={expanded()}>
              <box flexDirection="column" paddingLeft={1} paddingTop={0}>
                <text>Loading PRs from GitHub</text>
              </box>
            </Show>
          </box>
        )
      },
    },
  }
  api.slots.register(slots)
}

const plugin: TuiPluginModule = {
  id: "pr-dashboard",
  tui,
}

export default plugin
