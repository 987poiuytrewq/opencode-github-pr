// Pure formatting helpers used by the TUI sidebar: title truncation and
// relative age rendering.

const TITLE_BUDGET = 30

export function truncateTitle(title: string, numWidth: number): string {
  const budget = Math.max(8, TITLE_BUDGET - numWidth)
  if (title.length <= budget) return title
  return title.slice(0, budget - 1) + "…"
}

export function formatAge(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  return `${Math.floor(d / 30)}mo`
}
