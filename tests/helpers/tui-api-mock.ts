import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

function mockColor(hex: string) {
  return {
    toInts: () => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return [r, g, b, 255] as [number, number, number, number]
    },
  }
}

const TEST_THEME = {
  backgroundPanel: mockColor("#161616"),
  backgroundElement: mockColor("#1d1d1d"),
  border: mockColor("#3a3a3a"),
  borderActive: mockColor("#5f87ff"),
  text: mockColor("#e5e5e5"),
  textMuted: mockColor("#888888"),
  primary: mockColor("#5f87ff"),
  success: mockColor("#5fbf5f"),
  warning: mockColor("#d8a657"),
  error: mockColor("#d86565"),
}

export interface MockTuiApiRegistry {
  slots: any[]
  keymaps: any[]
  events: { type: string; handler: any }[]
  toasts: any[]
}

export function createMockTuiApi(): { api: any; registry: MockTuiApiRegistry } {
  const registry: MockTuiApiRegistry = {
    slots: [],
    keymaps: [],
    events: [],
    toasts: [],
  }

  const api = {
    theme: {
      current: TEST_THEME,
    },
    slots: {
      register: (plugin: any) => {
        registry.slots.push(plugin)
      },
    },
    keymap: {
      registerLayer: (layer: any) => {
        registry.keymaps.push(layer)
      },
    },
    event: {
      on: (type: string, handler: any) => {
        registry.events.push({ type, handler })
      },
    },
    ui: {
      toast: (input: any) => {
        registry.toasts.push(input)
      },
      dialog: {
        replace: () => {},
        clear: () => {},
        setSize: () => {},
      },
      DialogPrompt: () => null,
      Dialog: () => null,
      DialogAlert: () => null,
      DialogConfirm: () => null,
      DialogSelect: () => null,
      Slot: () => null,
      Prompt: () => null,
    },
    route: {
      register: () => () => {},
      navigate: () => {},
      current: { name: "session", params: { sessionID: "test-session" } },
    },
    client: {
      session: {
        prompt: async () => ({}),
      },
    },
  }

  return { api, registry }
}
