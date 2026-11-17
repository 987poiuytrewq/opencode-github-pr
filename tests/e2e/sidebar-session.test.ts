import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

const OPENCODE = "/opt/homebrew/bin/opencode"

describe.skipIf(!isE2E())("E2E: sidebar renders with active session", () => {
  let session: TmuxSession
  let repo: TempRepo

  beforeAll(async () => {
    repo = await makeTempRepo()
    session = await TmuxSession.create({
      name: `e2e-sess-${Date.now()}`,
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
  }, 60_000)

  afterAll(async () => {
    await session?.kill()
    repo?.cleanup()
  })

  test("Changes heading appears after session is created", async () => {
    await session.waitForText("opencode", { timeoutMs: 30_000 })
    await session.sendKeys("hello")
    await session.sendRaw("\r")
    await Bun.sleep(5000)
    const screen = await session.capturePanePlain()
    expect(screen).toContain("Changes")
  }, 60_000)

  test("filter label is not shown after session is created", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).not.toContain("author:@me")
  }, 30_000)
})
