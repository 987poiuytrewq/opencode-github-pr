// Local-git helpers: read .git/config and .git/HEAD directly so we don't
// need to spawn `git` or `gh` for repo detection / current-branch lookup.
//
// These are best-effort filesystem reads; failures surface as null and let
// the caller fall back to a "no repo" / "no branch PR" state.

import { existsSync, readFileSync, statSync } from "node:fs"
import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { Repo } from "../domain/types"
import { enterpriseHostname } from "./github-enterprise"

export type { Repo }

const HEAD_REF_PREFIX = "ref: refs/heads/"
const SSH_CONFIG_TIMEOUT_MS = 500
const sshHostCache = new Map<string, Promise<string | null>>()
export type SshHostResolver = (host: string) => Promise<string | null>

export function currentBranch(cwd: string): string | null {
  const paths = gitPaths(cwd)
  if (!paths?.branchDir) return null
  try {
    const headPath = join(paths.branchDir, "HEAD")
    if (!existsSync(headPath)) return null
    const head = readFileSync(headPath, "utf8").trim()
    if (!head.startsWith(HEAD_REF_PREFIX)) return null
    return head.slice(HEAD_REF_PREFIX.length) || null
  } catch {
    return null
  }
}

function remoteUrls(cwd: string): Array<{ name: string; url: string }> {
  const paths = gitPaths(cwd)
  if (!paths) return []
  for (const configPath of new Set([
    join(paths.commonDir, "config"),
    join(paths.gitDir, "config"),
  ])) {
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

type GitPaths = { gitDir: string; commonDir: string; branchDir: string | null }

function gitPaths(cwd: string): GitPaths | null {
  // Session directories may be nested below a checkout. Walk upward and stop
  // at the first Git marker so nested repositories take precedence over parents.
  let directory = resolve(cwd)
  while (true) {
    try {
      const dotGit = join(directory, ".git")
      if (existsSync(dotGit)) {
        let gitDir: string
        if (statSync(dotGit).isDirectory()) {
          gitDir = dotGit
        } else {
          const gitFile = readFileSync(dotGit, "utf8").trim()
          const match = /^gitdir:\s*(.+)$/m.exec(gitFile)
          gitDir = match ? resolve(directory, match[1].trim()) : ""
        }
        if (gitDir) return pathsForGitDir(gitDir, gitDir)
      }

      // A worktree container may keep its shared repository in a sibling .bare.
      // Its HEAD is the default branch, not the active worktree branch.
      const bareDir = join(directory, ".bare")
      if (isBareGitDir(bareDir)) return pathsForGitDir(bareDir, null)

      // Also support opening the bare repository directory directly.
      if (isBareGitDir(directory)) return pathsForGitDir(directory, directory)
    } catch {
      // A malformed marker may be inside a parent repository; keep searching.
    }

    const parent = resolve(directory, "..")
    if (parent === directory) return null
    directory = parent
  }
}

function pathsForGitDir(gitDir: string, branchDir: string | null): GitPaths {
  const commonDirFile = join(gitDir, "commondir")
  const commonDir = existsSync(commonDirFile)
    ? resolve(gitDir, readFileSync(commonDirFile, "utf8").trim())
    : gitDir
  return { gitDir, commonDir, branchDir }
}

function isBareGitDir(directory: string): boolean {
  try {
    return (
      statSync(directory).isDirectory() &&
      existsSync(join(directory, "config")) &&
      existsSync(join(directory, "HEAD")) &&
      statSync(join(directory, "objects")).isDirectory()
    )
  } catch {
    return false
  }
}

export function parseGitHubRemote(
  url: string,
  enterpriseUrl?: string,
): Repo | null {
  const remote = url.trim()
  const configuredHost = enterpriseHostname(enterpriseUrl)
  const supportedHosts = configuredHost
    ? [configuredHost]
    : ["github.com", "ssh.github.com"]
  const hostPattern = supportedHosts
    .map((host) => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
  // Git accepts both URI-style SSH URLs and scp-style SSH URLs.
  const scp = new RegExp(`^(?:git@)?(?:${hostPattern}):([^?#]+)$`, "i").exec(
    remote,
  )
  if (scp) return splitOwnerRepo(scp[1])

  try {
    const parsed = new URL(remote)
    if (
      !supportedHosts.includes(parsed.hostname.toLowerCase()) ||
      !["https:", "http:", "ssh:"].includes(parsed.protocol)
    ) {
      return null
    }
    if (
      !configuredHost &&
      parsed.hostname.toLowerCase() === "ssh.github.com" &&
      parsed.protocol !== "ssh:"
    ) {
      return null
    }
    return splitOwnerRepo(parsed.pathname)
  } catch {
    return null
  }
}

export async function detectRepo(
  cwd: string = process.cwd(),
  enterpriseUrl = process.env.GITHUB_ENTERPRISE_URL,
  resolveHost: SshHostResolver = sshHostName,
): Promise<Repo | null> {
  const remotes = remoteUrls(cwd)
  const rewrites = urlRewriteRules(cwd)
  const preferred = [
    ...remotes.filter(({ name }) => name === "origin"),
    ...remotes.filter(({ name }) => name !== "origin"),
  ]
  for (const { url } of preferred) {
    const rewritten = rewriteRemoteUrl(url, rewrites)
    const repo =
      parseGitHubRemote(rewritten, enterpriseUrl) ??
      parseGitHubRemote(await resolveSshAlias(rewritten, resolveHost), enterpriseUrl)
    if (repo) return repo
  }
  return null
}

export async function detectPushRemoteOwner(
  cwd: string,
  branch: string | null,
  enterpriseUrl = process.env.GITHUB_ENTERPRISE_URL,
  resolveHost: SshHostResolver = sshHostName,
): Promise<string | null> {
  if (!branch) return null
  const paths = gitPaths(cwd)
  if (!paths) return null

  const branchPushRemote = readConfigValue(cwd, "branch", branch, "pushRemote")
  const defaultPushRemote = readConfigValue(cwd, "remote", null, "pushDefault")
  const branchRemote = readConfigValue(cwd, "branch", branch, "remote")
  const remoteName = branchPushRemote || defaultPushRemote || branchRemote
  if (!remoteName || remoteName === ".") return null

  const rewrites = urlRewriteRules(cwd)
  for (const { name, url } of remoteUrls(cwd)) {
    if (name !== remoteName) continue
    const rewritten = rewriteRemoteUrl(url, rewrites)
    const repo =
      parseGitHubRemote(rewritten, enterpriseUrl) ??
      parseGitHubRemote(await resolveSshAlias(rewritten, resolveHost), enterpriseUrl)
    if (repo) return repo.owner
  }
  return null
}

type UrlRewrite = { prefix: string; base: string }

function readConfigValue(
  cwd: string,
  section: "branch" | "remote",
  subsection: string | null,
  key: string,
): string | null {
  const paths = gitPaths(cwd)
  if (!paths) return null
  const configPaths: string[] = []
  if (process.env.GIT_CONFIG_NOSYSTEM !== "1") {
    configPaths.push(process.env.GIT_CONFIG_SYSTEM || "/etc/gitconfig")
  }
  const home = homedir()
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(home, ".config")
  configPaths.push(join(xdgConfigHome, "git", "config"))
  configPaths.push(
    process.env.GIT_CONFIG_GLOBAL || join(home, ".gitconfig"),
    join(paths.commonDir, "config"),
    join(paths.gitDir, "config"),
  )

  let value: string | null = null
  for (const configPath of new Set(configPaths)) {
    try {
      if (!existsSync(configPath)) continue
      const text = readFileSync(configPath, "utf8")
      const escapedSubsection = subsection?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const sectionPattern = subsection === null
        ? new RegExp(`^\\s*\\[${section}\\]\\s*$`, "i")
        : new RegExp(`^\\s*\\[${section}\\s+"${escapedSubsection}"\\]\\s*$`, "i")
      const sectionRe = /^\s*\[.*\]\s*$/gm
      let sectionMatch: RegExpExecArray | null
      while ((sectionMatch = sectionRe.exec(text)) !== null) {
        if (!sectionPattern.test(sectionMatch[0])) continue
        const start = sectionRe.lastIndex
        const nextSection = /^\s*\[/gm
        nextSection.lastIndex = start
        const end = nextSection.exec(text)?.index ?? text.length
        const sectionText = text.slice(start, end)
        const keyRe = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, "gim")
        let keyMatch: RegExpExecArray | null
        while ((keyMatch = keyRe.exec(sectionText)) !== null) {
          value = unquoteConfigValue(keyMatch[1])
        }
      }
    } catch {
      // Missing or unreadable config scopes do not prevent branch filtering.
    }
  }
  return value
}

function urlRewriteRules(cwd: string): UrlRewrite[] {
  const paths = gitPaths(cwd)
  if (!paths) return []

  const configPaths: string[] = []
  if (process.env.GIT_CONFIG_NOSYSTEM !== "1") {
    configPaths.push(process.env.GIT_CONFIG_SYSTEM || "/etc/gitconfig")
  }
  const home = homedir()
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(home, ".config")
  configPaths.push(join(xdgConfigHome, "git", "config"))
  if (process.env.GIT_CONFIG_GLOBAL) {
    configPaths.push(process.env.GIT_CONFIG_GLOBAL)
  } else {
    configPaths.push(join(home, ".gitconfig"))
  }
  configPaths.push(
    join(paths.commonDir, "config"),
    join(paths.gitDir, "config"),
  )

  const rewrites: UrlRewrite[] = []
  for (const configPath of new Set(configPaths)) {
    try {
      if (!existsSync(configPath)) continue
      const text = readFileSync(configPath, "utf8")
      const sectionRe = /^\s*\[url\s+"((?:\\.|[^"])*)"\]\s*$/gim
      let section: RegExpExecArray | null
      while ((section = sectionRe.exec(text)) !== null) {
        const start = sectionRe.lastIndex
        const nextSection = /^\s*\[/gm
        nextSection.lastIndex = start
        const end = nextSection.exec(text)?.index ?? text.length
        const base = unquoteConfigValue(`"${section[1]}"`)
        const sectionText = text.slice(start, end)
        const prefixRe = /^\s*insteadOf\s*=\s*(.*?)\s*$/gim
        let prefix: RegExpExecArray | null
        while ((prefix = prefixRe.exec(sectionText)) !== null) {
          const value = unquoteConfigValue(prefix[1])
          if (base && value) rewrites.push({ base, prefix: value })
        }
      }
    } catch {
      // Missing or unreadable config scopes do not prevent local detection.
    }
  }
  return rewrites
}

function rewriteRemoteUrl(url: string, rewrites: UrlRewrite[]): string {
  let best: UrlRewrite | null = null
  for (const rewrite of rewrites) {
    if (
      url.startsWith(rewrite.prefix) &&
      (!best || rewrite.prefix.length > best.prefix.length)
    ) {
      best = rewrite
    }
  }
  return best ? `${best.base}${url.slice(best.prefix.length)}` : url
}

async function resolveSshAlias(
  url: string,
  resolveHost: SshHostResolver,
): Promise<string> {
  const scp = /^(?:([^@/:]+)@)?([A-Za-z0-9._-]+):([^?#]+)$/.exec(url)
  if (scp && !scp[2].startsWith("-")) {
    const hostName = scp[2].includes(".") ? null : await resolveHost(scp[2])
    return hostName ? `${scp[1] ? `${scp[1]}@` : ""}${hostName}:${scp[3]}` : url
  }

  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== "ssh:" ||
      !/^[A-Za-z0-9._-]+$/.test(parsed.hostname) ||
      parsed.hostname.startsWith("-")
    ) {
      return url
    }
    const hostName = parsed.hostname.includes(".")
      ? null
      : await resolveHost(parsed.hostname)
    if (hostName) parsed.hostname = hostName
    return parsed.toString()
  } catch {
    return url
  }
}

function sshHostName(host: string): Promise<string | null> {
  const normalized = host.toLowerCase()
  if (host.includes(".")) return Promise.resolve(null)
  const cached = sshHostCache.get(normalized)
  if (cached) return cached
  // `ssh -G` prints effective client configuration without opening a
  // connection. Keep execution asynchronous and bounded; public fully-qualified
  // hostnames are not aliases and never reach this path.
  const result = new Promise<string | null>((resolveResult) => {
    const userConfig = join(process.env.HOME || homedir(), ".ssh", "config")
    const args = existsSync(userConfig)
      ? ["-G", "-o", "CanonicalizeHostname=no", "-F", userConfig, host]
      : ["-G", "-o", "CanonicalizeHostname=no", host]
    execFile(
      "ssh",
      args,
      {
        encoding: "utf8",
        timeout: SSH_CONFIG_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        const match = typeof stdout === "string" ? /^hostname\s+(\S+)\s*$/im.exec(stdout) : null
        const hostName = match?.[1]
        const resolved =
          !error &&
          hostName &&
          hostName.toLowerCase() !== normalized &&
          /^[A-Za-z0-9.-]+$/.test(hostName)
            ? hostName
            : null
        resolveResult(resolved)
      },
    )
  })
  sshHostCache.set(normalized, result)
  return result
}

function splitOwnerRepo(path: string): Repo | null {
  const clean = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")
  const parts = clean.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}
