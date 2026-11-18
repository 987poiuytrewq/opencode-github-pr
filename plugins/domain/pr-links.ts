import type { PRLinkTarget } from "./types"

export function prTargetUrl(prUrl: string, target: PRLinkTarget = "overview"): string {
  const base = prUrl.replace(/\/+$/, "")
  if (target === "overview") return base
  return `${base}/${target}`
}
