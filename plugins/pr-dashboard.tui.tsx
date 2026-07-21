/** @jsxImportSource @opentui/solid */
import { createSignal, Show, createMemo } from "solid-js"
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { Header } from "./app/Header"
import { useDashboard } from "./app/usePRData"
import { skin } from "./domain/format"
import { isReadyToMerge } from "./domain/pr-status"
import type { State } from "./domain/types"

const tui: TuiPlugin = async (api) => {
  const sk = skin(api)
  const [state, setState] = createSignal<State>({
    status: "loading",
    repo: null,
    prs: [],
    fetchedAt: null,
    threadCounts: new Map(),
    branchRules: new Map(),
    filter: "author",
  })
  const [expanded, setExpanded] = createSignal(true)

  const ctx = useDashboard(state, setState)
  ctx.refresh()

  const counts = createMemo(() => {
    let ready = 0
    let notReady = 0
    for (const pr of state().prs) {
      const required = state().branchRules.get(pr.baseRefName) ?? null
      if (isReadyToMerge(pr, required)) ready++
      else notReady++
    }
    return { ready, notReady }
  })

  const toggleExpanded = () => setExpanded((v) => !v)

  const slots: TuiSlotPlugin = {
    order: 250,
    slots: {
      sidebar_content() {
        return (
          <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0}>
            <Header
              sk={sk}
              status={state().status}
              expanded={expanded()}
              onToggleExpand={toggleExpanded}
              filter={state().filter}
              onCycleFilter={ctx.cycleFilter}
              readyCount={counts().ready}
              notReadyCount={counts().notReady}
            />
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

  api.event.on("session.idle", () => {
    ctx.refresh()
  })
}

const plugin: TuiPluginModule = {
  id: "pr-dashboard",
  tui,
}

export default plugin
