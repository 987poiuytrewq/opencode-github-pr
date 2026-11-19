/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import { DashboardStatus, type DashboardState } from "../../plugins/domain/types"
import { useDashboard } from "../../plugins/app/usePRData"

// Creates a dashboard with reactive signals. Must live in a .tsx file so
// that Bun's @opentui/solid plugin rewrites solid-js imports to the
// reactive build (not the SSR build that .ts files get).
export function createDashboard(api: TuiPluginContext, includeClosed: () => boolean = () => false) {
  const [state, setState] = createSignal<DashboardState>({
    status: DashboardStatus.Loading,
    repo: null,
    prs: [],
    currentBranch: null,
    viewerLogin: null,
    fetchedAt: null,
    closedLoaded: false,
    truncated: { open: false, closed: false },
  })
  const dash = useDashboard(api, state, setState, undefined, undefined, includeClosed)
  dash.refresh()
  return { state, ...dash }
}
