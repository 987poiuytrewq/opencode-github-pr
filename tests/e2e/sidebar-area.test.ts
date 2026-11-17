import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

const OPENCODE = "/opt/homebrew/bin/opencode"

describe.skipIf(!isE2E())("E2E: sidebar content area", () => {
  let session: TmuxSession
  let repo: TempRepo

  beforeAll(async () => {
    repo = await makeTempRepo()
    session = await TmuxSession.create({
      name: `e2e-area-${Date.now()}`,
      cols: 140,
      rows: 40,
      cwd: repo.dir,
      env: {
        TERM: "xterm-256color",
        NO_COLOR: "1",
        OPENCODE_DISABLE_UPDATE: "1",
      },
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

  test("separator exists in pane", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("┃")
  }, 30_000)

  test("sidebar area has non-space content", async () => {
    const screen = await session.capturePanePlain()
    const lines = screen.split("\n")
    let foundNonSpace = false
    for (const line of lines) {
      const sepIdx = line.indexOf("┃")
      if (sepIdx <= 0) continue
      const rightSide = line.slice(sepIdx + 1)
      const nextSep = rightSide.indexOf("┃")
      if (nextSep <= 0) continue
      const sidebarContent = rightSide.slice(0, nextSep)
      if (sidebarContent.trim().length > 0) {
        foundNonSpace = true
        break
      }
    }
    expect(foundNonSpace).toBe(true)
  }, 30_000)

  test("sidebar contains Changes heading", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("Changes")
  }, 30_000)

  test("sidebar does not contain a filter label", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).not.toContain("author:@me")
  }, 30_000)
})
