import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E, hasPullRequestsHeading } from "./tmux"
import { makeTempRepo, startOpenCodeE2ESession, type TempRepo } from "./fixtures"

describe.skipIf(!isE2E())("E2E: sidebar renders with active session", () => {
  let session: TmuxSession
  let repo: TempRepo
  let stopSession: () => Promise<void>

  beforeAll(async () => {
    repo = await makeTempRepo()
    const launched = await startOpenCodeE2ESession(repo, `e2e-sess-${Date.now()}`)
    session = launched.session
    stopSession = launched.cleanup
  }, 60_000)

  afterAll(async () => {
    await stopSession?.()
    repo?.cleanup()
  })

  test("Pull Requests heading appears after session is created", async () => {
    const screen = await session.capturePanePlain()
    expect(hasPullRequestsHeading(screen)).toBe(true)
    expect(screen).toContain("No GitHub repo")
    expect(screen).not.toContain("Not authorised")
  }, 60_000)

  test("filter label is not shown after session is created", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).not.toContain("author:@me")
  }, 30_000)
})
