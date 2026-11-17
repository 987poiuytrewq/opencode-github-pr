import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"

function color(hex: string) {
  return {
    toInts: () => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      255,
    ] as [number, number, number, number],
  }
}

const TEST_THEME = {
  background: { base: color("#161616"), raised: { base: color("#1d1d1d") } },
  border: { base: color("#3a3a3a") },
  text: {
    base: color("#e5e5e5"),
    muted: color("#888888"),
    action: { primary: { base: color("#5f87ff") } },
    feedback: {
      success: { base: color("#5fbf5f") },
      warning: { base: color("#d8a657") },
      error: { base: color("#d86565") },
    },
  },
}

export interface MockTuiApiRegistry {
  slots: any[]
  keymaps: any[]
  events: { type: string; handler: any }[]
  toasts: any[]
  promptValue?: string
}

export function createMockTuiApi(): { api: TuiPluginContext; registry: MockTuiApiRegistry } {
  const registry: MockTuiApiRegistry = {
    slots: [],
    keymaps: [],
    events: [],
    toasts: [],
  }
  const location = { directory: process.cwd() }

  const api = {
    options: {},
    location,
    app: { version: "2.0.20", channel: "stable" },
    renderer: {} as any,
    theme: TEST_THEME,
    themeMode: "dark",
    data: {
      on: (type: string, handler: any) => {
        const event = { type, handler }
        registry.events.push(event)
        return () => {
          const index = registry.events.indexOf(event)
          if (index >= 0) registry.events.splice(index, 1)
        }
      },
      listen: () => () => {},
      session: {
        get: (sessionID: string) => ({ id: sessionID, location: { directory: process.cwd() } }),
      },
      location: { default: () => ({ directory: process.cwd() }) },
    },
    client: {
      session: { synthetic: async () => ({}) },
    },
    attention: { notify: async () => ({ ok: true, notification: false, sound: false }) },
    markdown: { registerCodeBlockRenderer: () => () => {} },
    keymap: {
      layer: (factory: () => any) => {
        registry.keymaps.push(factory())
      },
      dispatch: () => {},
      shortcuts: () => [],
      commands: () => [],
      pending: () => [],
      active: () => [],
      mode: { current: () => "global", push: () => () => {} },
    },
    storage: {
      store: () => [{}, async () => {}],
      memory: () => [{}, () => {}],
    },
    ui: {
      dialog: {
        show: () => {},
        set: () => {},
        clear: () => {},
        alert: async () => {},
        confirm: async () => true,
        prompt: async () => registry.promptValue,
        select: async () => undefined,
      },
      toast: { show: (toast: any) => registry.toasts.push(toast) },
      format: { path: (path: string) => path },
      router: { current: () => ({ type: "session", sessionID: "test-session" }) },
      panel: { open: () => true, close: () => {}, current: () => undefined },
      tabs: { enabled: () => false, list: () => [], open: () => false, focus: () => false, move: () => false, close: () => false },
      model: { current: () => undefined, variant: { list: () => [], set: () => false } },
      slot: (claim: any) => {
        const registered = {
          ...claim,
          slots: {
            sidebar_content: (_slotContext: any, props: { session_id: string }) =>
              claim.render({ sessionID: props.session_id }),
          },
        }
        registry.slots.push(registered)
        return () => {
          const index = registry.slots.indexOf(registered)
          if (index >= 0) registry.slots.splice(index, 1)
        }
      },
    },
  } as unknown as TuiPluginContext

  return { api, registry }
}
