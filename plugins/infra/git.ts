// Local-git helpers: read .git/config and .git/HEAD directly so we don't
// need to spawn `git` or `gh` for repo detection / current-branch lookup.
//
// These are best-effort filesystem reads; failures surface as null and let
// the caller fall back to a "no repo" / "no branch PR" state.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const HEAD_REF_PREFIX = "ref: refs/heads/"

export function currentBranch(cwd: string): string | null {
  const headPath = join(cwd, ".git", "HEAD")
  if (!existsSync(headPath)) return null
  const head = readFileSync(headPath, "utf8").trim()
  if (!head.startsWith(HEAD_REF_PREFIX)) return null
  return head.slice(HEAD_REF_PREFIX.length) || null
}

export function originRemoteUrl(cwd: string): string | null {
  const configPath = join(cwd, ".git", "config")
  if (!existsSync(configPath)) return null
  const text = readFileSync(configPath, "utf8")
  // Find the [remote "origin"] section and its url = ... line.
  const re = /\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/
  const match = re.exec(text)
  if (!match) return null
  const urlMatch = /^\s*url\s*=\s*(.+)\s*$/m.exec(match[1])
  return urlMatch ? urlMatch[1].trim() : null
}

export type Repo = { owner: string; repo: string }

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

function splitOwnerRepo(path: string): Repo | null {
  const clean = path.replace(/\.git$/, "").replace(/^\/+/, "")
  const slash = clean.indexOf("/")
  if (slash < 1) return null
  return { owner: clean.slice(0, slash), repo: clean.slice(slash + 1) }
}
