// Color/formatting helpers used by the TUI sidebar.

export const SK = {
  panel: "#161616",
  panelAlt: "#1d1d1d",
  border: "#3a3a3a",
  borderActive: "#5f87ff",
  text: "#e5e5e5",
  muted: "#888888",
  accent: "#5f87ff",
  success: "#5fbf5f",
  warning: "#d8a657",
  error: "#d86565",
  draft: "#888888",
}

export function toHex(c: { toInts(): [number, number, number, number] }): string {
  const [r, g, b] = c.toInts()
  return (
    "#" +
    [r, g, b]
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
      .join("")
  )
}

export function skin(api: { theme: { current: any } }) {
  const t = api.theme.current
  return {
    panel: toHex(t.backgroundPanel),
    panelAlt: toHex(t.backgroundElement),
    border: toHex(t.border),
    borderActive: toHex(t.borderActive),
    text: toHex(t.text),
    muted: toHex(t.textMuted),
    accent: toHex(t.primary),
    success: toHex(t.success),
    warning: toHex(t.warning),
    error: toHex(t.error),
  }
}

const TITLE_BUDGET = 30

export function truncateTitle(title: string, numWidth: number): string {
  const budget = Math.max(8, TITLE_BUDGET - numWidth)
  if (title.length <= budget) return title
  return title.slice(0, budget - 1) + "…"
}
