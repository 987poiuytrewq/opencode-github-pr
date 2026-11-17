import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E, OPENCODE_BIN } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

describe.skipIf(!isE2E())("E2E: PR dashboard collapse", () => {
  let session: TmuxSession
  let repo: TempRepo

  beforeAll(async () => {
    repo = await makeTempRepo()
    session = await TmuxSession.create({
      name: `e2e-collapse-${Date.now()}`,
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
    await session.waitForText("opencode", { timeoutMs: 30_000 })
    await session.sendKeys("hello")
    await session.sendRaw("\r")
    await Bun.sleep(3000)
  }, 90_000)

  afterAll(async () => {
    await session?.kill()
    repo?.cleanup()
  })

  test("PRs section shows ▼ initially", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("▼")
    expect(screen).toContain("PRs")
  }, 30_000)

  test("clicking ▼ collapses to ▶ and hides PR list", async () => {
    const screen = await session.capturePanePlain()
    const lines = screen.split("\n")
    let col = -1, row = -1
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf("▼")
      if (idx >= 0 && lines[i].includes("PRs")) {
        col = idx
        row = i
        break
      }
    }
    expect(col).toBeGreaterThan(-1)
    await session.click(col, row)
    await Bun.sleep(1500)
    const after = await session.capturePanePlain()
    expect(after).toContain("▶")
    expect(after).not.toContain("No open PRs")
  }, 30_000)

  test("clicking ▶ expands back to ▼", async () => {
    const screen = await session.capturePanePlain()
    const lines = screen.split("\n")
    let col = -1, row = -1
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf("▶")
      if (idx >= 0 && lines[i].includes("PRs")) {
        col = idx
        row = i
        break
      }
    }
    expect(col).toBeGreaterThan(-1)
    await session.click(col, row)
    await Bun.sleep(1500)
    const after = await session.capturePanePlain()
    expect(after).toContain("▼")
  }, 30_000)

  test("filter label shows author:@me", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("author:@me")
  }, 30_000)
})
