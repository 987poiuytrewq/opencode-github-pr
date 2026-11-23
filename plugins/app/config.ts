import type { PRScope, PRStatusFilter } from "../domain/types"
import { DEFAULT_SKIN, type Skin } from "./theme"
import {
  DEFAULT_RECENT_PRS_LIMIT,
  DEFAULT_TUI_PAGES_PER_BATCH,
  MAX_RECENT_PRS_LIMIT,
  MIN_PAGES_PER_BATCH,
} from "../infra/loader"

export const DEFAULT_ICONS = {
  openPR: "",
  closedPR: "",
  draftPR: "",
  mergedPR: "",
  review: "",
  openComment: "󰅺",
  check: "●",
  scope: "",
  loading: "󰔟",
  info: "",
  error: "",
  previousPage: "",
  nextPage: "",
}

export const UNICODE_ICONS = {
  openPR: "•",
  closedPR: "•",
  draftPR: "•",
  mergedPR: "•",
  review: "✓",
  openComment: "■",
  check: "●",
  scope: "",
  loading: "…",
  info: "ℹ",
  error: "⚠",
  previousPage: "◀",
  nextPage: "▶",
}

export type IconStyle = "nerd" | "unicode"

export type DashboardIcons = Record<keyof typeof DEFAULT_ICONS, string>

export type DashboardSpacing = {
  iconToCount: number
  sameTypeGroups: number
  differentTypeGroups: number
}

export type StatusIndicatorStyle = "count" | "merged" | "repeat"

export type StatusIndicatorStyles = {
  comments: StatusIndicatorStyle
  reviews: StatusIndicatorStyle
  checks: StatusIndicatorStyle
}

export const DEFAULT_SPACING: DashboardSpacing = {
  iconToCount: 0,
  sameTypeGroups: 0,
  differentTypeGroups: 1,
}

export const DEFAULT_STATUS_INDICATOR_STYLES: StatusIndicatorStyles = {
  comments: "count",
  reviews: "count",
  checks: "count",
}

export const DEFAULT_STATUS_INDICATOR_REPEAT_CAP = 3

const MAX_SPACING_GAP = 4
const MAX_STATUS_INDICATOR_REPEAT_CAP = 20

export type DashboardOptions = {
  enabled: boolean
  pageSize: number
  pagesPerBatch: number
  refreshIntervalMs: number
  requestTimeoutMs: number
  recentPRsLimit: number
  defaultScope: PRScope
  defaultStatusFilter: PRStatusFilter
  iconStyle: IconStyle
  showSingleStatusCount: boolean
  statusIndicatorStyles: StatusIndicatorStyles
  statusIndicatorRepeatCap: number
  spacing: DashboardSpacing
  colors: Partial<Skin>
  icons: DashboardIcons
}

type DashboardOptionsInput = {
  enabled?: unknown
  pageSize?: unknown
  pagesPerBatch?: unknown
  refreshIntervalMs?: unknown
  requestTimeoutMs?: unknown
  recentPRsLimit?: unknown
  defaultScope?: unknown
  defaultStatusFilter?: unknown
  iconStyle?: unknown
  showSingleStatusCount?: unknown
  statusIndicatorStyles?: unknown
  statusIndicatorRepeatCap?: unknown
  spacing?: unknown
  colors?: unknown
  icons?: unknown
}

const scopes: PRScope[] = ["branch", "author", "assignee", "all"]
const statusFilters: PRStatusFilter[] = ["open", "closed", "all"]

export const DEFAULT_PAGE_SIZE = 5
export const DEFAULT_PAGES_PER_BATCH = DEFAULT_TUI_PAGES_PER_BATCH
export const DEFAULT_REFRESH_INTERVAL_MS = 60_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback
}

function nonNegativeInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(max, Math.floor(value))
    : fallback
}

function spacingOverrides(input: unknown): DashboardSpacing {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ...DEFAULT_SPACING }
  const values = input as Record<string, unknown>
  return {
    iconToCount: nonNegativeInteger(values.iconToCount, DEFAULT_SPACING.iconToCount, MAX_SPACING_GAP),
    sameTypeGroups: nonNegativeInteger(values.sameTypeGroups, DEFAULT_SPACING.sameTypeGroups, MAX_SPACING_GAP),
    differentTypeGroups: nonNegativeInteger(
      values.differentTypeGroups,
      DEFAULT_SPACING.differentTypeGroups,
      MAX_SPACING_GAP,
    ),
  }
}

function statusIndicatorStyle(value: unknown): StatusIndicatorStyle {
  return value === "merged" || value === "repeat" ? value : "count"
}

function statusIndicatorStyles(input: unknown): StatusIndicatorStyles {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_STATUS_INDICATOR_STYLES }
  }
  const values = input as Record<string, unknown>
  return {
    comments: statusIndicatorStyle(values.comments),
    reviews: statusIndicatorStyle(values.reviews),
    checks: statusIndicatorStyle(values.checks),
  }
}

function stringOverrides<T extends Record<string, string>>(
  defaults: T,
  input: unknown,
  allowEmpty = false,
): Partial<T> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const result: Partial<T> = {}
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = (input as Record<string, unknown>)[key as string]
    if (typeof value === "string" && (value.trim() || (allowEmpty && value === ""))) {
      result[key] = value as T[keyof T]
    }
  }
  return result
}

function mergeStrings<T extends Record<string, string>>(defaults: T, input: unknown, allowEmpty = false): T {
  return { ...defaults, ...stringOverrides(defaults, input, allowEmpty) }
}

export function dashboardOptions(input: DashboardOptionsInput = {}): DashboardOptions {
  const iconStyle: IconStyle = input.iconStyle === "unicode" ? "unicode" : "nerd"
  const defaultIcons = iconStyle === "unicode" ? UNICODE_ICONS : DEFAULT_ICONS

  return {
    enabled: input.enabled !== false,
    pageSize: positiveNumber(input.pageSize, DEFAULT_PAGE_SIZE),
    pagesPerBatch: Math.max(MIN_PAGES_PER_BATCH, positiveNumber(input.pagesPerBatch, DEFAULT_PAGES_PER_BATCH)),
    refreshIntervalMs: positiveNumber(input.refreshIntervalMs, DEFAULT_REFRESH_INTERVAL_MS),
    requestTimeoutMs: positiveNumber(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    recentPRsLimit: nonNegativeInteger(input.recentPRsLimit, DEFAULT_RECENT_PRS_LIMIT, MAX_RECENT_PRS_LIMIT),
    defaultScope: scopes.includes(input.defaultScope as PRScope) ? (input.defaultScope as PRScope) : "author",
    defaultStatusFilter: statusFilters.includes(input.defaultStatusFilter as PRStatusFilter)
      ? (input.defaultStatusFilter as PRStatusFilter)
      : "open",
    iconStyle,
    showSingleStatusCount: input.showSingleStatusCount === true,
    statusIndicatorStyles: statusIndicatorStyles(input.statusIndicatorStyles),
    statusIndicatorRepeatCap: nonNegativeInteger(
      input.statusIndicatorRepeatCap,
      DEFAULT_STATUS_INDICATOR_REPEAT_CAP,
      MAX_STATUS_INDICATOR_REPEAT_CAP,
    ),
    spacing: spacingOverrides(input.spacing),
    colors: stringOverrides(DEFAULT_SKIN, input.colors),
    icons: mergeStrings(defaultIcons, input.icons, true),
  }
}
