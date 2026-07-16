// Low-level wrapper around `bun.spawn` for invoking `gh` commands.
//
// `runGh` is the only direct spawn call site: it returns a discriminated
// `{ok, output, error}` shape so callers don't have to wrangle exit codes,
// stdout/stderr streams, or default error messages. Higher-level fetch
// functions (`fetchPRs`, `fetchReviewerThreads`, etc.) compose this with
// the specific `gh` subcommand and flags they need.

import { spawn } from "../bun-utils"

export type GhResult = {
  ok: boolean
  output: string
  error?: string
}

export async function runGh(args: string[]): Promise<GhResult> {
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
    proc.exited.then((code) => {
      resolve({
        ok: code === 0,
        output: out.join("").trim(),
        error: code !== 0 ? err.join("").trim() || `gh exited ${code}` : undefined,
      })
    })
  })
}
