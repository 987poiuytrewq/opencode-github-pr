import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E } from "./tmux"
import { makeTempRepo, type TempRepo } from "./fixtures"

const OPENCODE = "/opt/homebrew/bin/opencode"

describe.skipIf(!isE2E())("E2E: PR dashboard sidebar renders", () => {
  let session: TmuxSession
  let repo: TempRepo

  beforeAll(async () => {
    repo = await makeTempRepo()
    session = await TmuxSession.create({
      name: `e2e-sidebar-${Date.now()}`,
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

  test("sidebar shows PRs header", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("PRs")
  }, 30_000)

  test("sidebar shows filter label", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("author:@me")
  }, 30_000)

  test("sidebar content is left of the separator", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("PRs")
    expect(screen).toContain("author:@me")
  }, 30_000)
})
