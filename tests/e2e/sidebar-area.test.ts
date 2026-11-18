import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { TmuxSession, isE2E } from "./tmux"
import { checkoutRepo, startOpenCodeE2ESession, type TempRepo } from "./fixtures"

describe.skipIf(!isE2E())("E2E: sidebar content area", () => {
  let session: TmuxSession
  let repo: TempRepo
  let stopSession: () => Promise<void>

  beforeAll(async () => {
    repo = checkoutRepo()
    const launched = await startOpenCodeE2ESession(repo, `e2e-area-${Date.now()}`)
    session = launched.session
    stopSession = launched.cleanup
  }, 90_000)

  afterAll(async () => {
    await stopSession?.()
    repo?.cleanup()
  })

  test("separator exists in pane", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("┃")
  }, 30_000)

  test("sidebar area contains the Changes heading", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).toContain("Changes")
  }, 30_000)

  test("sidebar does not contain a filter label", async () => {
    const screen = await session.capturePanePlain()
    expect(screen).not.toContain("author:@me")
  }, 30_000)
})
