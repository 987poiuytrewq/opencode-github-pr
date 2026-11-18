/** @jsxImportSource @opentui/solid */
import open from "open"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import { prTargetUrl } from "../domain/pr-links"
import type { DashboardContext, PRLinkTarget } from "../domain/types"

export interface PrActions {
  openPR: (n: number, target?: PRLinkTarget) => Promise<void>
}

// Build callbacks used by the sidebar and keymap using the V2 local TUI API.
export function createActions(api: TuiPluginContext, ctx: DashboardContext): PrActions {
  const openPR = async (n: number, target: PRLinkTarget = "overview") => {
    const pr = ctx.state().prs.find((p) => p.number === n)
    if (!pr) return
    try {
      await open(prTargetUrl(pr.url, target))
      api.ui.toast.show({ variant: "info", message: `Opening #${n} in browser…`, duration: 1500 })
    } catch {
      api.ui.toast.show({ variant: "error", message: `Couldn't open #${n} in browser`, duration: 2500 })
    }
  }

  return { openPR }
}
