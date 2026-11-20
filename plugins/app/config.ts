import type { PRScope, PRStatusFilter } from "../domain/types"
import { DEFAULT_SKIN, type Skin } from "./theme"
import { DEFAULT_TUI_PAGES_PER_BATCH, MIN_PAGES_PER_BATCH } from "../infra/loader"

export const DEFAULT_ICONS = {
  openPR: "",
  mergedPR: "",
  review: "",
  openComment: "󰅺",
  check: "●",
  scope: "",
  status: "",
  loading: "󰔟",
  info: "",
  error: "",
  previousPage: "",
  nextPage: "",
}

export const UNICODE_ICONS = {
  openPR: "•",
  mergedPR: "•",
  review: "✓",
  openComment: "■",
  check: "●",
  scope: "",
  status: "",
  loading: "…",
  info: "ℹ",
  error: "⚠",
  previousPage: "◀",
  nextPage: "▶",
}

export type IconStyle = "nerd" | "unicode"

export type DashboardIcons = Record<keyof typeof DEFAULT_ICONS, string>

export type DashboardOptions = {
  enabled: boolean
  pageSize: number
  pagesPerBatch: number
  refreshIntervalMs: number
  requestTimeoutMs: number
  defaultScope: PRScope
  defaultStatusFilter: PRStatusFilter
  iconStyle: IconStyle
  colors: Partial<Skin>
  icons: DashboardIcons
}

type DashboardOptionsInput = {
  enabled?: unknown
  pageSize?: unknown
  pagesPerBatch?: unknown
  refreshIntervalMs?: unknown
  requestTimeoutMs?: unknown
  defaultScope?: unknown
  defaultStatusFilter?: unknown
  iconStyle?: unknown
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
  const iconStyle: IconStyle = input.iconStyle === "nerd" ? "nerd" : "unicode"
  const defaultIcons = iconStyle === "unicode" ? UNICODE_ICONS : DEFAULT_ICONS

  return {
    enabled: input.enabled !== false,
    pageSize: positiveNumber(input.pageSize, DEFAULT_PAGE_SIZE),
    pagesPerBatch: Math.max(MIN_PAGES_PER_BATCH, positiveNumber(input.pagesPerBatch, DEFAULT_PAGES_PER_BATCH)),
    refreshIntervalMs: positiveNumber(input.refreshIntervalMs, DEFAULT_REFRESH_INTERVAL_MS),
    requestTimeoutMs: positiveNumber(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    defaultScope: scopes.includes(input.defaultScope as PRScope) ? (input.defaultScope as PRScope) : "author",
    defaultStatusFilter: statusFilters.includes(input.defaultStatusFilter as PRStatusFilter)
      ? (input.defaultStatusFilter as PRStatusFilter)
      : "open",
    iconStyle,
    colors: stringOverrides(DEFAULT_SKIN, input.colors),
    icons: mergeStrings(defaultIcons, input.icons, true),
  }
}
