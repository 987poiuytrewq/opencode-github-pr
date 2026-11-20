import { describe, expect, test } from "bun:test"
import { dashboardOptions, DEFAULT_ICONS, UNICODE_ICONS } from "../../plugins/app/config"
import { DEFAULT_SKIN } from "../../plugins/app/theme"

describe("dashboard options", () => {
  test("uses distinct Nerd Font PR icons when Nerd Font style is selected", () => {
    expect(DEFAULT_ICONS.openPR).toBe("")
    expect(DEFAULT_ICONS.mergedPR).toBe("")
    expect(dashboardOptions({ iconStyle: "nerd" }).iconStyle).toBe("nerd")
  })

  test("defaults to Nerd Font icons", () => {
    expect(dashboardOptions()).toEqual({
      enabled: true,
      pageSize: 5,
      pagesPerBatch: 4,
      refreshIntervalMs: 60_000,
      requestTimeoutMs: 15_000,
      defaultScope: "author",
      defaultStatusFilter: "open",
      iconStyle: "nerd",
      colors: {},
      icons: { ...DEFAULT_ICONS },
    })
  })

  test("accepts valid behavior, color, and icon overrides", () => {
    expect(
      dashboardOptions({
        pageSize: 8,
        pagesPerBatch: 4,
        refreshIntervalMs: 30_000,
        requestTimeoutMs: 10_000,
        defaultScope: "assignee",
        defaultStatusFilter: "closed",
        colors: { accent: "#123456", merged: "magenta", unsupported: "#fff" },
        icons: { openPR: "P", nextPage: ">" },
      }),
    ).toEqual({
      enabled: true,
      pageSize: 8,
      pagesPerBatch: 4,
      refreshIntervalMs: 30_000,
      requestTimeoutMs: 10_000,
      defaultScope: "assignee",
      defaultStatusFilter: "closed",
      iconStyle: "nerd",
      colors: { accent: "#123456", merged: "magenta" },
      icons: { ...DEFAULT_ICONS, openPR: "P", nextPage: ">" },
    })
  })

  test("keeps each fetch batch at least four TUI pages", () => {
    expect(dashboardOptions({ pagesPerBatch: 1 }).pagesPerBatch).toBe(4)
  })

  test("uses Nerd or Unicode icons as selected and lets explicit icon overrides take precedence", () => {
    expect(dashboardOptions({ iconStyle: "nerd" })).toMatchObject({
      iconStyle: "nerd",
      icons: DEFAULT_ICONS,
    })
    expect(dashboardOptions({ iconStyle: "unicode" })).toMatchObject({
      iconStyle: "unicode",
      icons: UNICODE_ICONS,
    })
    expect(dashboardOptions({ iconStyle: "unicode", icons: { openPR: "P" } })).toMatchObject({
      iconStyle: "unicode",
      icons: { ...UNICODE_ICONS, openPR: "P" },
    })
  })

  test("allows empty icon overrides to hide individual icons", () => {
    expect(dashboardOptions({ icons: { scope: "" } }).icons).toMatchObject({ scope: "" })
  })

  test("ignores colour and icon keys that no longer have an effect", () => {
    const options = dashboardOptions({
      colors: { panel: "#000000", panelAlt: "#1d1d1d", border: "#111111", borderActive: "#222222" },
      icons: { status: "X" },
    })
    expect(options.colors).toEqual({})
    expect(options.icons).not.toHaveProperty("status")
  })

  test("ignores invalid values and empty color/icon strings", () => {
    expect(
      dashboardOptions({
        pageSize: -1,
        pagesPerBatch: 0,
        refreshIntervalMs: "soon",
        requestTimeoutMs: 0,
        defaultScope: "unknown",
        defaultStatusFilter: "pending",
        iconStyle: "unknown",
        colors: { accent: "" },
        icons: { openPR: " " },
      }),
    ).toMatchObject({
      pageSize: 5,
      pagesPerBatch: 4,
      refreshIntervalMs: 60_000,
      requestTimeoutMs: 15_000,
      defaultScope: "author",
      defaultStatusFilter: "open",
      iconStyle: "nerd",
      colors: {},
      icons: DEFAULT_ICONS,
    })
    expect(Object.keys(DEFAULT_SKIN)).toHaveLength(8)
  })
})
