import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E, OPENCODE_BIN } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

describe.skipIf(!isE2E())("E2E smoke: opencode launches in tmux", () => {
  let session: TmuxSession
  let repo: TempRepo

  beforeAll(async () => {
    repo = await makeTempRepo()
    session = await TmuxSession.create({
      name: `e2e-smoke-${Date.now()}`,
      cols: 140,
      rows: 40,
      cwd: repo.dir,
      env: {
        TERM: "xterm-256color",
        NO_COLOR: "1",
        OPENCODE_DISABLE_UPDATE: "1",
      },
      command: [OPENCODE_BIN, "--standalone"],
    })
  }, 60_000)

  afterAll(async () => {
    await session?.kill()
    repo?.cleanup()
  })

  test("opencode TUI renders", async () => {
    await session.waitForText("opencode", { timeoutMs: 30_000 })
    const screen = await session.capturePanePlain()
    console.log("=== SCREEN CAPTURE ===")
    console.log(screen)
    console.log("=== END ===")
    expect(screen.length).toBeGreaterThan(0)
  }, 60_000)
})
