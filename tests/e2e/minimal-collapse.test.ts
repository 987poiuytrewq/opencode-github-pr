import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

const OPENCODE = "/opt/homebrew/bin/opencode"

describe.skipIf(!isE2E())("E2E: minimal plugin collapse", () => {
  let session: TmuxSession
  let repo: TempRepo

  beforeAll(async () => {
    repo = await makeTempRepo()
    session = await TmuxSession.create({
      name: `e2e-min-${Date.now()}`,
      cols: 140,
      rows: 40,
      cwd: repo.dir,
      env: { TERM: "xterm-256color", NO_COLOR: "1", OPENCODE_DISABLE_UPDATE: "1" },
      command: [OPENCODE],
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

  test("Loading text visible when expanded", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("Loading PRs from GitHub")
  }, 30_000)

  test("clicking ▼ collapses to ▶ and hides Loading text", async () => {
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
    console.log(`Clicking ▼ at col=${col}, row=${row}`)
    await session.click(col, row)
    await Bun.sleep(1500)
    const after = await session.capturePanePlain()
    console.log("After click:", after.split("\n").filter(l => l.includes("PRs") || l.includes("▶") || l.includes("▼") || l.includes("Loading")).join("\n"))
    expect(after).toContain("▶")
    expect(after).not.toContain("Loading PRs from GitHub")
  }, 30_000)

  test("clicking ▶ expands back to ▼ and shows Loading text", async () => {
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
    expect(after).toContain("Loading PRs from GitHub")
  }, 30_000)
})
