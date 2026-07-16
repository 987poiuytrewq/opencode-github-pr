// Login display helpers and bot-account aliases used by the TUI sidebar.

export const BOT_ALIASES: Record<string, string> = {
  "copilot-pull-request-reviewer": "copilot",
  "copilot-swe-agent": "copilot",
  "copilot": "copilot",
  "dependabot": "dependabot",
  "dependabot-preview": "dependabot",
  "github-actions": "github-actions",
  "renovate": "renovate",
  "renovate-bot": "renovate",
  "graphite-app": "graphite",
  "graphite-ci": "graphite",
}

export function displayLogin(login: string): string {
  const lower = login.toLowerCase()
  if (BOT_ALIASES[lower]) return BOT_ALIASES[lower]
  if (lower.endsWith("[bot]")) {
    const base = lower.slice(0, -5)
    return BOT_ALIASES[base] ?? base
  }
  if (lower.endsWith("-bot")) {
    const base = lower.slice(0, -4)
    return BOT_ALIASES[base] ?? base
  }
  return login
}

export function ellipsize(name: string, maxLen = 9): string {
  if (name.length <= maxLen) return name
  return name.slice(0, 4) + "…" + name.slice(-4)
}
