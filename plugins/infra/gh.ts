// Low-level wrapper around `bun.spawn` for invoking `gh` commands.
//
// After the Octokit migration, this is used only for `gh auth token`
// (which has no Octokit equivalent and is needed once at startup to
// read the user's existing gh auth state). All other GitHub calls go
// through Octokit directly.
//
// Includes a default timeout so a hung `gh` process can't block plugin
// init indefinitely.

import { spawn } from "../bun-utils"

export type GhResult = {
  ok: boolean
  output: string
  error?: string
  timedOut?: boolean
}

const DEFAULT_TIMEOUT_MS = 10_000

export async function runGh(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<GhResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve) => {
    const proc = spawn({ cmd: args, stdout: "pipe", stderr: "pipe" })
    const out: string[] = []
    const err: string[] = []
    proc.stdout.pipeTo(
      new WritableStream({
        write: (chunk) => out.push(new TextDecoder().decode(chunk)),
      }),
    )
    proc.stderr.pipeTo(
      new WritableStream({
        write: (chunk) => err.push(new TextDecoder().decode(chunk)),
      }),
    )
    const timer = setTimeout(() => {
      try {
        proc.kill?.()
      } catch {}
      resolve({
        ok: false,
        output: out.join("").trim(),
        error: `gh timed out after ${timeoutMs}ms`,
        timedOut: true,
      })
    }, timeoutMs)
    proc.exited.then((code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        output: out.join("").trim(),
        error: code !== 0 ? err.join("").trim() || `gh exited ${code}` : undefined,
        timedOut: false,
      })
    })
  })
}
