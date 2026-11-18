// Pure formatting helpers used by the TUI sidebar: title truncation and
// relative age rendering.

export function truncateTitle(title: string, maxWidth: number): string {
  const budget = Math.max(1, Math.floor(maxWidth))
  if (title.length <= budget) return title

  const prefix = title.slice(0, budget - 1)
  const wordBoundary = prefix.lastIndexOf(" ")
  const truncated = wordBoundary > 0
    ? prefix.slice(0, wordBoundary).trimEnd()
    : prefix.trimEnd()
  return `${truncated}…`
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
