/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { DashboardStatus, PRFilter, type DashboardState } from "../../plugins/domain/types"
import { useDashboard } from "../../plugins/app/usePRData"

// Creates a dashboard with reactive signals. Must live in a .tsx file so
// that Bun's @opentui/solid plugin rewrites solid-js imports to the
// reactive build (not the SSR build that .ts files get).
export function createDashboard(api: TuiPluginApi) {
  const [state, setState] = createSignal<DashboardState>({
    status: DashboardStatus.Loading,
    repo: null,
    prs: [],
    fetchedAt: null,
    threadCounts: new Map(),
    branchRules: new Map(),
    filter: PRFilter.Author,
  })
  const dash = useDashboard(api, state, setState)
  dash.refresh()
  return { state, ...dash }
}
