// Pure formatting helpers used by the TUI sidebar.

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function truncateTitle(title: string, maxWidth: number): string {
  const budget = Math.max(1, Math.floor(maxWidth))
  const normalized = title.replace(/\s+/gu, " ").trim()
  if (Bun.stringWidth(normalized) <= budget) return normalized

  const contentBudget = Math.max(0, budget - Bun.stringWidth("…"))
  let wholeWords = ""
  for (const word of normalized.split(" ")) {
    const next = wholeWords ? `${wholeWords} ${word}` : word
    if (Bun.stringWidth(next) > contentBudget) break
    wholeWords = next
  }
  if (wholeWords) return `${wholeWords}…`

  // If even the first word is too long, fall back to a grapheme-safe cut.
  let prefix = ""
  for (const { segment } of graphemes.segment(normalized)) {
    const next = prefix + segment
    if (Bun.stringWidth(next) > contentBudget) break
    prefix = next
  }
  return `${prefix}…`
}
