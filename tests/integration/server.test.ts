import { describe, expect, test } from "bun:test"
import { PrDashboardPlugin } from "../../plugins/pr-dashboard"

describe("PrDashboardPlugin V2 server part", () => {
  test("keeps a stable V2 plugin id without registering reviewer tools", async () => {
    expect(PrDashboardPlugin.id).toBe("opencode-github-pr")
    let registeredTools = 0
    await PrDashboardPlugin.setup({
      tool: {
        transform: async (register: (editor: any) => void) => {
          register({ add: () => registeredTools++ })
          return { dispose: async () => {} }
        },
      },
    } as any)
    expect(registeredTools).toBe(0)
  })
})
