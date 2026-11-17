import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawn } from "bun"

export interface TempRepo {
  dir: string
  cleanup: () => void
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
  const remoteUrl = opts.remoteUrl ?? "https://github.com/octocat/Hello-World.git"
  const repoRoot = resolve(import.meta.dir, "../..")
  const tempRoot = join(repoRoot, "node_modules", ".cache")
  mkdirSync(tempRoot, { recursive: true })
  const dir = mkdtempSync(join(tempRoot, "opencode-e2e-"))
  await runGit(dir, ["init", "--initial-branch=main"])
  await runGit(dir, ["remote", "add", "origin", remoteUrl])
  writeFileSync(
    join(dir, "opencode.json"),
    JSON.stringify({ plugins: [repoRoot] }),
  )
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

export function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "opencode-e2e-"))
  return {
    dir,
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    },
  }
}
