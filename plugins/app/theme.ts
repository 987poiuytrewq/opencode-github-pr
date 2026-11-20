// Convert OpenCode V2 semantic theme tokens into the palette used by the PR
// dashboard components.

import type { ResolvedTheme } from "@opencode/theme/tui"

export const DEFAULT_SKIN = {
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
  merged: "#a371f7",
}

export type Skin = {
  panel: string
  panelAlt: string
  border: string
  borderActive: string
  text: string
  muted: string
  accent: string
  success: string
  warning: string
  error: string
  draft: string
  merged: string
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

export function skin(t: ResolvedTheme, overrides: Partial<Skin> = {}): Skin {
  return {
    panel: toHex(t.background.base),
    panelAlt: toHex(t.background.raised.base),
    border: toHex(t.border.base),
    borderActive: toHex(t.text.action.primary.base),
    text: toHex(t.text.base),
    muted: toHex(t.text.muted),
    accent: toHex(t.text.action.primary.base),
    success: toHex(t.text.feedback.success.base),
    warning: toHex(t.text.feedback.warning.base),
    error: toHex(t.text.feedback.error.base),
    draft: toHex(t.text.muted),
    merged: toHex(t.hue.interactive[200]),
    ...overrides,
  }
}
