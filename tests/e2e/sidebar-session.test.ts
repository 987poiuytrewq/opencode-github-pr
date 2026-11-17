import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E, OPENCODE_BIN } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

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
      command: [OPENCODE_BIN, "--standalone"],
    })
  }, 60_000)

  afterAll(async () => {
    await session?.kill()
    repo?.cleanup()
  })

  test("PRs header appears after session is created", async () => {
    await session.waitForText("opencode", { timeoutMs: 30_000 })
    await session.sendKeys("hello")
    await session.sendRaw("\r")
    await Bun.sleep(5000)
    const screen = await session.capturePanePlain()
    expect(screen).toContain("PRs")
  }, 60_000)

  test("filter label appears after session is created", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("author:@me")
  }, 30_000)
})
