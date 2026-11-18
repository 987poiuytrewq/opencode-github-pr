import type { PRLinkTarget } from "./types"

export function prTargetUrl(prUrl: string, target: PRLinkTarget = "overview"): string {
  const base = prUrl.replace(/\/+$/, "")
  if (target === "overview") return base
  if (target === "mergeStatus") {
    const url = new URL(base)
    url.searchParams.set("panel", "mergeStatus")
    return url.toString()
  }
  return `${base}/${target}`
}
