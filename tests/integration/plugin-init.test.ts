import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clearOctokitMocks, installOctokitMock } from "../helpers/octokit-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"

installOctokitMock()

const plugin_mod = await import("../../plugins/pr-dashboard.tui")
const plugin = plugin_mod.default

beforeEach(() => {
  clearOctokitMocks()
  installOctokitMock()
})

afterEach(() => {
  clearOctokitMocks()
})

describe("V2 TUI plugin setup", () => {
  test("has a stable plugin id and sets up without throwing", async () => {
    expect(plugin.id).toBe("opencode-github-pr.tui")
    const { api } = createMockTuiApi()
    const cleanup = await plugin.setup(api)
    expect(cleanup).toBeFunction()
    cleanup?.()
  })

  test("registers a sidebar slot", async () => {
    const { api, registry } = createMockTuiApi()
    const cleanup = await plugin.setup(api)
    expect(registry.slots.map((slot) => slot.append)).toContain("sidebar.content")
    expect(registry.slots.find((slot) => slot.append === "sidebar.content").render).toBeFunction()
    cleanup?.()
    expect(registry.slots).toHaveLength(0)
  })

  test("registers palette and slash commands", async () => {
    const { api, registry } = createMockTuiApi()
    const cleanup = await plugin.setup(api)
    expect(registry.keymaps).toHaveLength(0)
    const appSlot = registry.slots.find((slot) => slot.append === "app")
    appSlot.render({})
    expect(registry.keymaps).toHaveLength(1)
    const commands = registry.keymaps[0].commands
    const ids = commands.map((item: any) => item.id)
    expect(ids).toContain("opencode-github-pr.refresh")
    expect(ids).toContain("opencode-github-pr.open")
    expect(ids).not.toContain("opencode-github-pr.add-reviewer")
    expect(ids).not.toContain("opencode-github-pr.rerequest-review")
    expect(ids).not.toContain("opencode-github-pr.add-current-branch-reviewer")
    expect(commands.find((item: any) => item.id === "opencode-github-pr.refresh").slash.name).toBe("pr-refresh")
    cleanup?.()
  })

  test("subscribes to session idle and cleans up its subscription", async () => {
    const { api, registry } = createMockTuiApi()
    const cleanup = await plugin.setup(api)
    expect(registry.events.map((event) => event.type)).toContain("session.idle")
    cleanup?.()
    expect(registry.events).toHaveLength(0)
  })

  test("returns early when disabled", async () => {
    const { api, registry } = createMockTuiApi()
    ;(api as any).options = { enabled: false }
    const cleanup = await plugin.setup(api)
    expect(cleanup).toBeUndefined()
    expect(registry.slots).toHaveLength(0)
    expect(registry.keymaps).toHaveLength(0)
    expect(registry.events).toHaveLength(0)
  })
})
