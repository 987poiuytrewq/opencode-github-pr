import { describe, expect, test } from "bun:test"
import { dashboardOptions, DEFAULT_ICONS } from "../../plugins/app/config"
import { DEFAULT_SKIN } from "../../plugins/app/theme"

describe("dashboard options", () => {
  test("preserves the existing dashboard defaults", () => {
    expect(dashboardOptions()).toEqual({
      enabled: true,
      pageSize: 5,
      maxPRPages: 3,
      refreshIntervalMs: 60_000,
      requestTimeoutMs: 15_000,
      defaultScope: "author",
      defaultStatusFilter: "open",
      colors: {},
      icons: { ...DEFAULT_ICONS },
    })
  })

  test("accepts valid behavior, color, and icon overrides", () => {
    expect(
      dashboardOptions({
        pageSize: 8,
        maxPRPages: 4,
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
      maxPRPages: 4,
      refreshIntervalMs: 30_000,
      requestTimeoutMs: 10_000,
      defaultScope: "assignee",
      defaultStatusFilter: "closed",
      colors: { accent: "#123456", merged: "magenta" },
      icons: { ...DEFAULT_ICONS, openPR: "P", nextPage: ">" },
    })
  })

  test("ignores invalid values and empty color/icon strings", () => {
    expect(
      dashboardOptions({
        pageSize: -1,
        maxPRPages: 0,
        refreshIntervalMs: "soon",
        requestTimeoutMs: 0,
        defaultScope: "unknown",
        defaultStatusFilter: "pending",
        colors: { accent: "" },
        icons: { openPR: " " },
      }),
    ).toMatchObject({
      pageSize: 5,
      maxPRPages: 3,
      refreshIntervalMs: 60_000,
      requestTimeoutMs: 15_000,
      defaultScope: "author",
      defaultStatusFilter: "open",
      colors: {},
      icons: DEFAULT_ICONS,
    })
    expect(Object.keys(DEFAULT_SKIN)).toHaveLength(12)
  })
})
