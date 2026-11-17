import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E } from "./tmux"
import { checkoutRepo, startOpenCodeE2ESession, type TempRepo } from "./fixtures"

describe.skipIf(!isE2E())("E2E: PR dashboard collapse", () => {
  let session: TmuxSession
  let repo: TempRepo
  let stopSession: () => Promise<void>

  beforeAll(async () => {
    repo = checkoutRepo()
    const launched = await startOpenCodeE2ESession(repo, `e2e-collapse-${Date.now()}`)
    session = launched.session
    stopSession = launched.cleanup
  }, 90_000)

  afterAll(async () => {
    await stopSession?.()
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
