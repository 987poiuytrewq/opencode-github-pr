import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { createServer } from "node:net"
import { spawn } from "bun"
import { TmuxSession, hasPullRequestsHeading, OPENCODE_BIN } from "./tmux"

export interface TempRepo {
  dir: string
  cleanup: () => void
}

export interface OpenCodeE2ESession {
  session: TmuxSession
  cleanup: () => Promise<void>
}

function runGit(dir: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(["git", ...args], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    Promise.all([proc.exited, new Response(proc.stderr).text()]).then(([code, err]) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} exited ${code}: ${err}`))
      } else {
        resolve()
      }
    })
  })
}

export async function makeTempRepo(opts: {
  remoteUrl?: string
  initialCommit?: boolean
} = {}): Promise<TempRepo> {
  // An unsupported remote keeps the dashboard's repository detection on the
  // local no-GitHub path. E2E tests exercise the TUI without contacting GitHub.
  const remoteUrl = opts.remoteUrl ?? "https://example.invalid/octocat/Hello-World.git"
  const repoRoot = resolve(import.meta.dir, "../..")
  const tempRoot = join(repoRoot, "node_modules", ".cache")
  mkdirSync(tempRoot, { recursive: true })
  const dir = mkdtempSync(join(tempRoot, "opencode-e2e-"))
  await runGit(dir, ["init", "--initial-branch=main"])
  await runGit(dir, ["remote", "add", "origin", remoteUrl])
  if (opts.initialCommit !== false) {
    writeFileSync(join(dir, "README.md"), "# test repo\n")
    await runGit(dir, ["add", "."])
    const proc = spawn(["git", "commit", "-m", "initial"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@test.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@test.com" },
    })
    await proc.exited
  }
  return {
    dir,
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    },
  }
}

export async function startOpenCodeE2ESession(
  repo: TempRepo,
  name: string,
): Promise<OpenCodeE2ESession> {
  const portProbe = createServer()
  await new Promise<void>((resolve, reject) => {
    portProbe.once("error", reject)
    portProbe.listen(0, "127.0.0.1", resolve)
  })
  const address = portProbe.address()
  if (!address || typeof address === "string") throw new Error("Could not allocate a port")
  const port = address.port
  await new Promise<void>((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()))

  const serverUrl = `http://127.0.0.1:${port}`
  const serverPassword = "e2e-local-only"
  const configDir = mkdtempSync(join(tmpdir(), "opencode-e2e-config-"))
  const configPath = join(configDir, "opencode.json")
  writeFileSync(configPath, JSON.stringify({
    plugins: [resolve(import.meta.dir, "../..")],
  }))
  const e2eEnvironment = {
    // Do not pass a developer's credentials into test processes. If the
    // GitHub API boundary is crossed unexpectedly, auth fails closed.
    GITHUB_TOKEN: "",
    GH_TOKEN: "",
    GITHUB_PERSONAL_ACCESS_TOKEN: "",
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
  }
  const serverEnv = {
    ...process.env,
    ...e2eEnvironment,
    OPENCODE_DISABLE_UPDATE: "1",
    OPENCODE_PASSWORD: serverPassword,
    OPENCODE_SERVER_PASSWORD: serverPassword,
  }
  const server = spawn([OPENCODE_BIN, "serve", "--log-level", "debug", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: resolve(import.meta.dir, "../.."),
    env: serverEnv,
    stdout: "ignore",
    stderr: "ignore",
  })
  let sessionID: string | undefined
  let session: TmuxSession | undefined
  const deleteServerSession = async () => {
    if (!sessionID) return
    try {
      await fetch(`${serverUrl}/api/session/${sessionID}`, {
        method: "DELETE",
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`,
        },
      })
    } catch {}
  }

  try {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${serverUrl}/api/session`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`,
          },
          body: JSON.stringify({ location: { directory: repo.dir } }),
        })
        if (response.ok) {
          const body = await response.json() as { data?: { id?: string } }
          sessionID = body.data?.id
          break
        }
      } catch {}
      await Bun.sleep(200)
    }
    if (!sessionID) throw new Error("OpenCode API did not create an E2E session")

    const createdSession = await TmuxSession.create({
      name,
      cols: 140,
      rows: 40,
      cwd: repo.dir,
      env: {
        OPENCODE_PASSWORD: serverPassword,
        OPENCODE_SERVER_PASSWORD: serverPassword,
        TERM: "xterm-256color",
        NO_COLOR: "1",
        OPENCODE_DISABLE_UPDATE: "1",
        ...e2eEnvironment,
      },
      command: [OPENCODE_BIN, "--server", serverUrl, "--session", sessionID],
    })
    session = createdSession
    await createdSession.waitForText("opencode", { timeoutMs: 30_000 })
    await createdSession.waitFor(
      hasPullRequestsHeading,
      { timeoutMs: 30_000, label: "Pull Requests heading" },
    )
    await createdSession.waitForText("Not a git repo", { timeoutMs: 30_000 })

    return {
      session: createdSession,
      cleanup: async () => {
        await createdSession.kill()
        await deleteServerSession()
        server.kill()
        await server.exited
        rmSync(configDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await session?.kill()
    await deleteServerSession()
    try {
      server.kill()
      await server.exited
    } catch {}
    rmSync(configDir, { recursive: true, force: true })
    throw error
  }
}

export function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "opencode-e2e-"))
  return {
    dir,
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    },
  }
}
