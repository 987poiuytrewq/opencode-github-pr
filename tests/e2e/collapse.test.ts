import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E, hasPullRequestsHeading } from "./tmux"
import { makeTempRepo, startOpenCodeE2ESession, type TempRepo } from "./fixtures"

describe.skipIf(!isE2E())("E2E: PR dashboard header", () => {
  let session: TmuxSession
  let repo: TempRepo
  let stopSession: () => Promise<void>

  beforeAll(async () => {
    repo = await makeTempRepo()
    const launched = await startOpenCodeE2ESession(repo, `e2e-header-${Date.now()}`)
    session = launched.session
    stopSession = launched.cleanup
  }, 90_000)

  afterAll(async () => {
    await stopSession?.()
    repo?.cleanup()
  })

  test("Pull Requests heading has no collapse affordance", async () => {
    const screen = await session.capturePanePlain()
    expect(hasPullRequestsHeading(screen)).toBe(true)
    expect(screen).not.toContain("▼")
    expect(screen).not.toContain("▶")
  }, 30_000)

  test("clicking the heading does not hide the dashboard", async () => {
    const screen = await session.capturePanePlain()
    expect(hasPullRequestsHeading(screen)).toBe(true)
    const lines = screen.split("\n")
    let col = -1, row = -1
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf("Pull")
      if (idx >= 0) {
        col = idx
        row = i
        break
      }
    }
    expect(col).toBeGreaterThan(-1)
    await session.click(col, row)
    const after = await session.capturePanePlain()
    expect(hasPullRequestsHeading(after)).toBe(true)
    expect(after).not.toContain("▼")
    expect(after).not.toContain("▶")
  }, 30_000)

  test("filter label is not shown", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).not.toContain("author:@me")
  }, 30_000)
})
