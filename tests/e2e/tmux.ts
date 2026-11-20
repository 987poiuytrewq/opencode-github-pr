import { spawn, type Subprocess } from "bun"

export class TmuxSession {
  readonly name: string
  readonly cols: number
  readonly rows: number
  private readonly tmuxBin: string

  private constructor(name: string, cols: number, rows: number, tmuxBin: string) {
    this.name = name
    this.cols = cols
    this.rows = rows
    this.tmuxBin = tmuxBin
  }

  static async create(opts: {
    name: string
    cols: number
    rows: number
    cwd: string
    env?: Record<string, string>
    command: string[]
    tmuxBin?: string
  }): Promise<TmuxSession> {
    const session = new TmuxSession(opts.name, opts.cols, opts.rows, opts.tmuxBin ?? "tmux")
    const args = [
      "new-session",
      "-d",
      "-s", opts.name,
      "-x", String(opts.cols),
      "-y", String(opts.rows),
      "-c", opts.cwd,
    ]
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      args.push("-e", `${k}=${v}`)
    }
    args.push("--", ...opts.command)
    let created = false
    try {
      await session.run(session.tmuxBin, args)
      created = true
      await session.run(session.tmuxBin, ["set-option", "-t", opts.name, "mouse", "off"])
      return session
    } catch (error) {
      // Only clean up sessions this call created; a failed new-session may
      // indicate that a same-name session already existed.
      if (created) await session.kill()
      throw error
    }
  }

  private run(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn([cmd, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = proc.stdout as ReadableStream<Uint8Array>
      const stderr = proc.stderr as ReadableStream<Uint8Array>
      let out = ""
      let err = ""
      const text = (s: ReadableStream<Uint8Array>) =>
        new Response(s).text()
      Promise.all([text(stdout), text(stderr), proc.exited]).then(([o, e, code]) => {
        out = o
        err = e
        if (code !== 0) {
          reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${err}`))
        } else {
          resolve(out)
        }
      })
    })
  }

  sendKeys(text: string): Promise<void> {
    return this.run(this.tmuxBin, ["send-keys", "-t", this.name, text]).then(() => {})
  }

  sendRaw(bytes: string): Promise<void> {
    return this.run(this.tmuxBin, ["send-keys", "-t", this.name, "-l", bytes]).then(() => {})
  }

  async capturePane(): Promise<string> {
    return this.run(this.tmuxBin, [
      "capture-pane",
      "-t", this.name,
      "-p",
      "-e",
    ])
  }

  async capturePanePlain(): Promise<string> {
    return this.run(this.tmuxBin, [
      "capture-pane",
      "-t", this.name,
      "-p",
    ])
  }

  async waitFor(
    predicate: (screen: string) => boolean,
    opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 30_000
    const intervalMs = opts.intervalMs ?? 200
    const label = opts.label ?? "condition"
    const deadline = Date.now() + timeoutMs
    let last = ""
    while (Date.now() < deadline) {
      last = await this.capturePanePlain()
      if (predicate(last)) return
      await Bun.sleep(intervalMs)
    }
    throw new Error(
      `waitFor(${label}) timed out after ${timeoutMs}ms. Last screen:\n${last}`,
    )
  }

  async waitForText(text: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
    return this.waitFor(
      (s) => s.includes(text),
      { ...opts, label: `text=${JSON.stringify(text)}` },
    )
  }

  async click(col: number, row: number): Promise<void> {
    // SGR mouse coordinates are 1-based; text capture is 0-based.
    const c = col + 1
    const r = row + 1
    const press = `\x1b[<0;${c};${r}M`
    const release = `\x1b[<0;${c};${r}m`
    await this.sendRaw(press)
    await Bun.sleep(20)
    await this.sendRaw(release)
  }

  async paneTty(): Promise<string> {
    return this.run(this.tmuxBin, ["display", "-t", this.name, "-p", "#{pane_tty}"])
  }

  async writeToTty(bytes: string): Promise<void> {
    const tty = await this.paneTty()
    await Bun.write(Bun.file(tty), bytes)
  }

  async kill(): Promise<void> {
    try {
      await this.run(this.tmuxBin, ["kill-session", "-t", this.name])
    } catch {}
  }
}

export function isE2E(): boolean {
  return process.env.E2E === "1" || process.env.E2E === "true"
}

export function hasPullRequestsHeading(screen: string): boolean {
  // The heading may wrap around other sidebar content at narrow widths.
  const lines = screen.split("\n")
  return lines.some((line, index) =>
    line.includes("Pull") &&
    (line.includes("Requests") || lines[index + 1]?.includes("Requests")),
  )
}

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "opencode"

export function e2eDescribe(name: string, fn: () => void): void {
  const { describe, test } = require("bun:test")
  if (isE2E()) {
    describe(name, fn)
  } else {
    describe.skip(name, fn)
  }
}
