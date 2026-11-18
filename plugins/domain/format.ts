// Pure formatting helpers used by the TUI sidebar: title truncation and
// relative age rendering.

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function truncateTitle(title: string, maxWidth: number): string {
  const budget = Math.max(1, Math.floor(maxWidth))
  const normalized = title.replace(/\s+/gu, " ").trim()
  if (Bun.stringWidth(normalized) <= budget) return normalized

  const contentBudget = Math.max(0, budget - Bun.stringWidth("…"))
  let prefix = ""
  let truncated = ""
  for (const { segment } of graphemes.segment(normalized)) {
    const next = prefix + segment
    if (Bun.stringWidth(next) > contentBudget) break
    prefix = next
    truncated = prefix
  }

  const wordBoundary = truncated.lastIndexOf(" ")
  if (wordBoundary > 0) truncated = truncated.slice(0, wordBoundary).trimEnd()
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
