import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { TmuxSession } from "./tmux"

describe("TmuxSession.create", () => {
  test("kills a session when setup fails after new-session succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-e2e-tmux-"))
    const tmuxBin = join(dir, "tmux")
    const killed = join(dir, "killed")
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    writeFileSync(
      tmuxBin,
      `#!/bin/sh
case "$1" in
  new-session) exit 0 ;;
  set-option) exit 1 ;;
  kill-session) touch ${quote(killed)}; exit 0 ;;
  *) exit 1 ;;
esac
`,
    )
    chmodSync(tmuxBin, 0o755)

    try {
      await expect(
        TmuxSession.create({
          name: "e2e-cleanup-check",
          cols: 80,
          rows: 24,
          cwd: dir,
          command: ["true"],
          tmuxBin,
        }),
      ).rejects.toThrow("set-option")
      expect(existsSync(killed)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
