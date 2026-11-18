import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E, hasPullRequestsHeading } from "./tmux"
import { makeTempRepo, startOpenCodeE2ESession, type TempRepo } from "./fixtures"

describe.skipIf(!isE2E())("E2E: PR dashboard sidebar renders", () => {
  let session: TmuxSession
  let repo: TempRepo
  let stopSession: () => Promise<void>

  beforeAll(async () => {
    repo = await makeTempRepo()
    const launched = await startOpenCodeE2ESession(repo, `e2e-sidebar-${Date.now()}`)
    session = launched.session
    stopSession = launched.cleanup
  }, 90_000)

  afterAll(async () => {
    await stopSession?.()
    repo?.cleanup()
  })

  test("sidebar shows Pull Requests heading", async () => {
    const screen = await session.capturePanePlain()
    expect(hasPullRequestsHeading(screen)).toBe(true)
    expect(screen).toContain("Not a git repo")
    expect(screen).not.toContain("Not authorised")
  }, 30_000)

  test("sidebar does not show filter label", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).not.toContain("author:@me")
  }, 30_000)

  test("sidebar content is left of the separator", async () => {
    const screen = await session.capturePanePlain()
    expect(hasPullRequestsHeading(screen)).toBe(true)
    expect(screen).not.toContain("author:@me")
  }, 30_000)
})
