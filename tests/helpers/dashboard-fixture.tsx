/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import { DashboardStatus, type DashboardState, type PRScope, type PRStatusFilter } from "../../plugins/domain/types"
import { useDashboard } from "../../plugins/app/usePRData"

// Creates a dashboard with reactive signals. Must live in a .tsx file so
// that Bun's @opentui/solid plugin rewrites solid-js imports to the
// reactive build (not the SSR build that .ts files get).
export function createDashboard(
  api: TuiPluginContext,
  statusFilter: () => PRStatusFilter = () => "open",
  scopeFilter: () => PRScope = () => "all",
  pageSize = 5,
) {
  const [state, setState] = createSignal<DashboardState>({
    status: DashboardStatus.Loading,
    repo: null,
    prs: [],
    currentBranch: null,
    viewerLogin: null,
    fetchedAt: null,
    pagination: {
      listing: "open",
      scope: "all",
      scopeValue: null,
      cursor: null,
      hasMore: false,
      totalCount: null,
      pagesLoaded: 0,
      searchResultsFetched: 0,
      supplementalPRCount: 0,
      loading: false,
      limitReached: false,
    },
  })
  const dash = useDashboard(api, state, setState, undefined, undefined, statusFilter, scopeFilter, pageSize)
  dash.refresh()
  return { state, ...dash }
}
