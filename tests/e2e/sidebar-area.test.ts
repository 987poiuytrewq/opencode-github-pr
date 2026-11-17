import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E, OPENCODE_BIN } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

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

  test("separator exists in pane", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("┃")
  }, 30_000)

  test("sidebar area has non-space content", async () => {
    const screen = await session.capturePanePlain()
    expect(screen.split("\n").some((line) => line.includes("PRs") && line.indexOf("PRs") > 70)).toBe(true)
  }, 30_000)

  test("sidebar contains PRs text", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("PRs")
  }, 30_000)

  test("sidebar contains filter label", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("author:@me")
  }, 30_000)
})
