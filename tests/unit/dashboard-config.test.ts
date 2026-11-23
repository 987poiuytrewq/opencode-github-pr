import { describe, expect, test } from "bun:test"
import {
  dashboardOptions,
  DEFAULT_ICONS,
  DEFAULT_SPACING,
  DEFAULT_STATUS_INDICATOR_REPEAT_CAP,
  DEFAULT_STATUS_INDICATOR_STYLES,
  UNICODE_ICONS,
} from "../../plugins/app/config"
import { DEFAULT_SKIN } from "../../plugins/app/theme"

describe("dashboard options", () => {
  test("uses distinct Nerd Font PR icons when Nerd Font style is selected", () => {
    expect(DEFAULT_ICONS.openPR).toBe("")
    expect(DEFAULT_ICONS.closedPR).toBe(DEFAULT_ICONS.openPR)
    expect(DEFAULT_ICONS.draftPR).toBe(DEFAULT_ICONS.openPR)
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
      recentPRsLimit: 5,
      defaultScope: "author",
      defaultStatusFilter: "open",
      iconStyle: "nerd",
      showSingleStatusCount: false,
      statusIndicatorStyles: DEFAULT_STATUS_INDICATOR_STYLES,
      statusIndicatorRepeatCap: DEFAULT_STATUS_INDICATOR_REPEAT_CAP,
      spacing: DEFAULT_SPACING,
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
        recentPRsLimit: 12,
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
      recentPRsLimit: 12,
      defaultScope: "assignee",
      defaultStatusFilter: "closed",
      iconStyle: "nerd",
      showSingleStatusCount: false,
      statusIndicatorStyles: DEFAULT_STATUS_INDICATOR_STYLES,
      statusIndicatorRepeatCap: DEFAULT_STATUS_INDICATOR_REPEAT_CAP,
      spacing: DEFAULT_SPACING,
      colors: { accent: "#123456", merged: "magenta" },
      icons: { ...DEFAULT_ICONS, openPR: "P", nextPage: ">" },
    })
  })

  test("validates indicator spacing and single-status count options", () => {
    expect(dashboardOptions({
      spacing: { iconToCount: 2.8, sameTypeGroups: 3, differentTypeGroups: 9 },
      showSingleStatusCount: true,
    })).toMatchObject({
      spacing: { iconToCount: 2, sameTypeGroups: 3, differentTypeGroups: 4 },
      showSingleStatusCount: true,
    })

    expect(dashboardOptions({
      spacing: { iconToCount: -1, sameTypeGroups: "2", differentTypeGroups: Number.NaN },
      showSingleStatusCount: "true",
    })).toMatchObject({
      spacing: DEFAULT_SPACING,
      showSingleStatusCount: false,
    })
    expect(dashboardOptions({ spacing: [] })).toMatchObject({ spacing: DEFAULT_SPACING })
  })

  test("validates per-group status indicator styles", () => {
    expect(dashboardOptions({
      statusIndicatorStyles: { comments: "merged", reviews: "repeat", checks: "merged" },
    }).statusIndicatorStyles).toEqual({ comments: "merged", reviews: "repeat", checks: "merged" })

    expect(dashboardOptions({
      statusIndicatorStyles: { comments: "invalid", reviews: "invalid", checks: "repeat" },
    }).statusIndicatorStyles).toEqual({ comments: "count", reviews: "count", checks: "repeat" })
    expect(dashboardOptions({
      statusIndicatorStyles: [],
    }).statusIndicatorStyles).toEqual(DEFAULT_STATUS_INDICATOR_STYLES)
  })

  test("validates the repeated status icon cap", () => {
    expect(dashboardOptions({ statusIndicatorRepeatCap: 2.8 }).statusIndicatorRepeatCap).toBe(2)
    expect(dashboardOptions({ statusIndicatorRepeatCap: 30 }).statusIndicatorRepeatCap).toBe(20)
    expect(dashboardOptions({ statusIndicatorRepeatCap: -1 }).statusIndicatorRepeatCap)
      .toBe(DEFAULT_STATUS_INDICATOR_REPEAT_CAP)
  })

  test("keeps each fetch batch at least four TUI pages", () => {
    expect(dashboardOptions({ pagesPerBatch: 1 }).pagesPerBatch).toBe(4)
  })

  test("allows disabling recent PR supplementation and clamps its limit", () => {
    expect(dashboardOptions({ recentPRsLimit: 0 }).recentPRsLimit).toBe(0)
    expect(dashboardOptions({ recentPRsLimit: 7.8 }).recentPRsLimit).toBe(7)
    expect(dashboardOptions({ recentPRsLimit: 1000 }).recentPRsLimit).toBe(100)
    expect(dashboardOptions({ recentPRsLimit: -1 }).recentPRsLimit).toBe(5)
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
    expect(UNICODE_ICONS.closedPR).toBe(UNICODE_ICONS.openPR)
    expect(UNICODE_ICONS.draftPR).toBe(UNICODE_ICONS.openPR)
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
      colors: { panel: "#000000", border: "#111111", borderActive: "#222222" },
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
        recentPRsLimit: "five",
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
      recentPRsLimit: 5,
      defaultScope: "author",
      defaultStatusFilter: "open",
      iconStyle: "nerd",
      colors: {},
      icons: DEFAULT_ICONS,
    })
    expect(Object.keys(DEFAULT_SKIN)).toHaveLength(9)
  })
})
