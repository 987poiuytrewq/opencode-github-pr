// Local-git helpers: read .git/config and .git/HEAD directly so we don't
// need to spawn `git` or `gh` for repo detection / current-branch lookup.
//
// These are best-effort filesystem reads; failures surface as null and let
// the caller fall back to a "no repo" / "no branch PR" state.

import { existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import type { Repo } from "../domain/types"
import { enterpriseHostname } from "./github-enterprise"

export type { Repo }

const HEAD_REF_PREFIX = "ref: refs/heads/"

export function currentBranch(cwd: string): string | null {
  const paths = gitPaths(cwd)
  if (!paths) return null
  try {
    const headPath = join(paths.gitDir, "HEAD")
    if (!existsSync(headPath)) return null
    const head = readFileSync(headPath, "utf8").trim()
    if (!head.startsWith(HEAD_REF_PREFIX)) return null
    return head.slice(HEAD_REF_PREFIX.length) || null
  } catch {
    return null
  }
}

export function originRemoteUrl(cwd: string): string | null {
  return remoteUrls(cwd).find(({ name }) => name === "origin")?.url ?? null
}

function remoteUrls(cwd: string): Array<{ name: string; url: string }> {
  const paths = gitPaths(cwd)
  if (!paths) return []
  for (const configPath of new Set([join(paths.commonDir, "config"), join(paths.gitDir, "config")])) {
    try {
      if (!existsSync(configPath)) continue
      const text = readFileSync(configPath, "utf8")
      const remotes: Array<{ name: string; url: string }> = []
      const sectionRe = /^\s*\[remote\s+"([^"]+)"\]\s*$/gim
      let section: RegExpExecArray | null

      while ((section = sectionRe.exec(text)) !== null) {
        const start = sectionRe.lastIndex
        const nextSection = /^\s*\[/gm
        nextSection.lastIndex = start
        const end = nextSection.exec(text)?.index ?? text.length
        const sectionText = text.slice(start, end)
        const urlRe = /^\s*url\s*=\s*(.*?)\s*$/gim
        let urlMatch: RegExpExecArray | null
        while ((urlMatch = urlRe.exec(sectionText)) !== null) {
          const url = unquoteConfigValue(urlMatch[1])
          if (url) remotes.push({ name: section[1], url })
        }
      }

      if (remotes.length) return remotes
    } catch {
      // Try the other config location, or let callers report no repository.
    }
  }
  return []
}

function unquoteConfigValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1")
  }
  return trimmed
}

function gitPaths(cwd: string): { gitDir: string; commonDir: string } | null {
  let directory = resolve(cwd)
  while (true) {
    const dotGit = join(directory, ".git")
    try {
      if (existsSync(dotGit)) {
        let gitDir: string
        if (statSync(dotGit).isDirectory()) {
          gitDir = dotGit
        } else {
          const gitFile = readFileSync(dotGit, "utf8").trim()
          const match = /^gitdir:\s*(.+)$/m.exec(gitFile)
          if (match) gitDir = resolve(directory, match[1].trim())
          else gitDir = ""
        }

        if (gitDir) {
          const commonDirFile = join(gitDir, "commondir")
          const commonDir = existsSync(commonDirFile)
            ? resolve(gitDir, readFileSync(commonDirFile, "utf8").trim())
            : gitDir
          return { gitDir, commonDir }
        }
      }
    } catch {
      // A malformed marker may be inside a parent repository; keep searching.
    }

    const parent = resolve(directory, "..")
    if (parent === directory) return null
    directory = parent
  }
}

export function parseGitHubRemote(url: string, enterpriseUrl?: string): Repo | null {
  const remote = url.trim()
  const configuredHost = enterpriseHostname(enterpriseUrl)
  const supportedHosts = configuredHost ? [configuredHost] : ["github.com", "ssh.github.com"]
  const hostPattern = supportedHosts.map((host) => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  // Git accepts both URI-style SSH URLs and scp-style SSH URLs.
  const scp = new RegExp(`^(?:git@)?(?:${hostPattern}):([^?#]+)$`, "i").exec(remote)
  if (scp) return splitOwnerRepo(scp[1])

  try {
    const parsed = new URL(remote)
    if (
      !supportedHosts.includes(parsed.hostname.toLowerCase()) ||
      !["https:", "http:", "ssh:"].includes(parsed.protocol)
    ) {
      return null
    }
    if (!configuredHost && parsed.hostname.toLowerCase() === "ssh.github.com" && parsed.protocol !== "ssh:") {
      return null
    }
    return splitOwnerRepo(parsed.pathname)
  } catch {
    return null
  }
}

export function detectRepo(
  cwd: string = process.cwd(),
  enterpriseUrl = process.env.GITHUB_ENTERPRISE_URL,
): Repo | null {
  const remotes = remoteUrls(cwd)
  const preferred = [
    ...remotes.filter(({ name }) => name === "origin"),
    ...remotes.filter(({ name }) => name !== "origin"),
  ]
  for (const { url } of preferred) {
    const repo = parseGitHubRemote(url, enterpriseUrl)
    if (repo) return repo
  }
  return null
}

function splitOwnerRepo(path: string): Repo | null {
  const clean = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")
  const parts = clean.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}
