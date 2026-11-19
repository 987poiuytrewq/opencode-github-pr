import type { PRScope, PRStatusFilter } from "../domain/types"
import { DEFAULT_SKIN, type Skin } from "./theme"

export const DEFAULT_ICONS = {
  openPR: "",
  mergedPR: "",
  review: "",
  openComment: "󰅺",
  check: "●",
  scope: "",
  status: "",
  loading: "󰔟",
  info: "",
  error: "",
  previousPage: "",
  nextPage: "",
}

export type DashboardIcons = Record<keyof typeof DEFAULT_ICONS, string>

export type DashboardOptions = {
  enabled: boolean
  pageSize: number
  refreshIntervalMs: number
  requestTimeoutMs: number
  defaultScope: PRScope
  defaultStatusFilter: PRStatusFilter
  colors: Partial<Skin>
  icons: DashboardIcons
}

type DashboardOptionsInput = {
  enabled?: unknown
  pageSize?: unknown
  refreshIntervalMs?: unknown
  requestTimeoutMs?: unknown
  defaultScope?: unknown
  defaultStatusFilter?: unknown
  colors?: unknown
  icons?: unknown
}

const scopes: PRScope[] = ["branch", "author", "assignee", "all"]
const statusFilters: PRStatusFilter[] = ["open", "closed", "all"]

export const DEFAULT_PAGE_SIZE = 5
// GitHub returns at most 100 search results per request.
export const MAX_PAGE_SIZE = 100
export const DEFAULT_REFRESH_INTERVAL_MS = 60_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback
}

function stringOverrides<T extends Record<string, string>>(defaults: T, input: unknown): Partial<T> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const result: Partial<T> = {}
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = (input as Record<string, unknown>)[key as string]
    if (typeof value === "string" && value.trim()) result[key] = value as T[keyof T]
  }
  return result
}

function mergeStrings<T extends Record<string, string>>(defaults: T, input: unknown): T {
  return { ...defaults, ...stringOverrides(defaults, input) }
}

export function dashboardOptions(input: DashboardOptionsInput = {}): DashboardOptions {
  return {
    enabled: input.enabled !== false,
    pageSize: Math.min(MAX_PAGE_SIZE, positiveNumber(input.pageSize, DEFAULT_PAGE_SIZE)),
    refreshIntervalMs: positiveNumber(input.refreshIntervalMs, DEFAULT_REFRESH_INTERVAL_MS),
    requestTimeoutMs: positiveNumber(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    defaultScope: scopes.includes(input.defaultScope as PRScope) ? (input.defaultScope as PRScope) : "author",
    defaultStatusFilter: statusFilters.includes(input.defaultStatusFilter as PRStatusFilter)
      ? (input.defaultStatusFilter as PRStatusFilter)
      : "open",
    colors: stringOverrides(DEFAULT_SKIN, input.colors),
    icons: mergeStrings(DEFAULT_ICONS, input.icons),
  }
}
