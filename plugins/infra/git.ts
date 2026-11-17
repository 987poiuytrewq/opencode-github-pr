// Local-git helpers: read .git/config and .git/HEAD directly so we don't
// need to spawn `git` or `gh` for repo detection / current-branch lookup.
//
// These are best-effort filesystem reads; failures surface as null and let
// the caller fall back to a "no repo" / "no branch PR" state.

import { existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import type { Repo } from "../domain/types"

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
  const paths = gitPaths(cwd)
  if (!paths) return null
  for (const configPath of new Set([
    join(paths.commonDir, "config"),
    join(paths.gitDir, "config"),
  ])) {
    try {
      if (!existsSync(configPath)) continue
      const text = readFileSync(configPath, "utf8")
      // Find the [remote "origin"] section and its url = ... line.
      const re = /\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/
      const match = re.exec(text)
      if (!match) continue
      const urlMatch = /^\s*url\s*=\s*(.+)\s*$/m.exec(match[1])
      if (urlMatch) return urlMatch[1].trim()
    } catch {
      // Try the other config location, or let callers report no repository.
    }
  }
  return null
}

function gitPaths(cwd: string): { gitDir: string; commonDir: string } | null {
  const dotGit = join(cwd, ".git")
  try {
    if (!existsSync(dotGit)) return null
    let gitDir: string
    if (statSync(dotGit).isDirectory()) {
      gitDir = dotGit
    } else {
      const gitFile = readFileSync(dotGit, "utf8").trim()
      const match = /^gitdir:\s*(.+)$/m.exec(gitFile)
      if (!match) return null
      gitDir = resolve(cwd, match[1].trim())
    }

    const commonDirFile = join(gitDir, "commondir")
    const commonDir = existsSync(commonDirFile)
      ? resolve(gitDir, readFileSync(commonDirFile, "utf8").trim())
      : gitDir
    return { gitDir, commonDir }
  } catch {
    return null
  }
}

const SSH_PREFIX = "git" + "@" + "github.com:"
const HTTPS_PREFIXES = ["https://github.com/", "http://github.com/"]

export function parseGitHubRemote(url: string): Repo | null {
  if (url.startsWith(SSH_PREFIX)) {
    const path = url.slice(SSH_PREFIX.length)
    return splitOwnerRepo(path)
  }
  for (const prefix of HTTPS_PREFIXES) {
    if (url.startsWith(prefix)) {
      const path = url.slice(prefix.length)
      return splitOwnerRepo(path)
    }
  }
  return null
}

export function detectRepo(cwd: string = process.cwd()): Repo | null {
  const url = originRemoteUrl(cwd)
  if (!url) return null
  return parseGitHubRemote(url)
}

function splitOwnerRepo(path: string): Repo | null {
  const clean = path.replace(/\.git$/, "").replace(/^\/+/, "")
  const slash = clean.indexOf("/")
  if (slash < 1) return null
  return { owner: clean.slice(0, slash), repo: clean.slice(slash + 1) }
}
