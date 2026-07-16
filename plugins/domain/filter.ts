// Available filter modes for the PR list. Filtering is done server-side
// by `fetchPRs(filter)` in infra/loader.ts, so this file only needs to
// declare the modes and their canonical order (used by the cycle button).

export { type Filter } from "./types"
import type { Filter } from "./types"

export const FILTERS: Filter[] = ["author", "assigned", "all"]
