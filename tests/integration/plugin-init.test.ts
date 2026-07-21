import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clearOctokitMocks, installOctokitMock } from "../helpers/octokit-mock"
import { createMockTuiApi } from "../helpers/tui-api-mock"

installOctokitMock()

const plugin_mod = await import("../../plugins/pr-dashboard.tui")
const plugin = plugin_mod.default as { id: string; tui: any }

beforeEach(() => {
  clearOctokitMocks()
  installOctokitMock()
})

afterEach(() => {
  clearOctokitMocks()
})

describe("plugin init", () => {
  test("tui() does not throw", async () => {
    const { api } = createMockTuiApi()
    await expect(plugin.tui(api, {} as any)).resolves.toBeUndefined()
  })

  test("registers sidebar_content slot", async () => {
    const { api, registry } = createMockTuiApi()
    await plugin.tui(api, {} as any)
    expect(registry.slots.length).toBe(1)
    expect(registry.slots[0].order).toBe(250)
    expect(registry.slots[0].slots.sidebar_content).toBeDefined()
  })

  test("registers keymap layer with all commands", async () => {
    const { api, registry } = createMockTuiApi()
    await plugin.tui(api, {} as any)
    expect(registry.keymaps.length).toBe(1)
    const names = registry.keymaps[0].commands.map((c: any) => c.name)
    expect(names).toContain("pr_dashboard.refresh")
    expect(names).toContain("pr_dashboard.open")
    expect(names).toContain("pr_dashboard.add_reviewer")
    expect(names).toContain("pr_dashboard.rerequest_review")
    expect(names).toContain("pr_dashboard.add_current_branch")
  })

  test("slash commands have correct slashName", async () => {
    const { api, registry } = createMockTuiApi()
    await plugin.tui(api, {} as any)
    const cmds = registry.keymaps[0].commands
    const refresh = cmds.find((c: any) => c.name === "pr_dashboard.refresh")
    expect(refresh.slashName).toBe("pr-refresh")
    const open = cmds.find((c: any) => c.name === "pr_dashboard.open")
    expect(open.slashName).toBe("pr-open")
  })

  test("registers session.idle event", async () => {
    const { api, registry } = createMockTuiApi()
    await plugin.tui(api, {} as any)
    expect(registry.events.length).toBe(1)
    expect(registry.events[0].type).toBe("session.idle")
  })

  test("returns early when disabled", async () => {
    const { api, registry } = createMockTuiApi()
    await plugin.tui(api, { enabled: false } as any)
    expect(registry.slots.length).toBe(0)
    expect(registry.keymaps.length).toBe(0)
    expect(registry.events.length).toBe(0)
  })
})
