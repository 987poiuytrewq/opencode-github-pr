import { describe, expect, test } from "bun:test"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { skin } from "../../plugins/app/theme"

function color(hex: string) {
  return {
    toInts: () => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      255,
    ] as [number, number, number, number],
  }
}

describe("skin", () => {
  test("uses the primary action theme color for merged PRs", () => {
    const primary = "#123abc"
    const theme = {
      background: { base: color("#161616"), raised: { base: color("#1d1d1d") } },
      border: { base: color("#3a3a3a") },
      text: {
        base: color("#e5e5e5"),
        muted: color("#888888"),
        action: { primary: { base: color(primary) } },
        feedback: {
          success: { base: color("#5fbf5f") },
          warning: { base: color("#d8a657") },
          error: { base: color("#d86565") },
        },
      },
    } as ResolvedTheme

    expect(skin(theme).merged).toBe(primary)
  })
})
