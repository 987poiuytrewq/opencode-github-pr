import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// Regression test: .ts files in plugins/ must NOT import reactive primitives
// from solid-js. Bun's @opentui/solid plugin only rewrites solid-js imports
// to the reactive build for .tsx/.jsx files. A .ts file importing createSignal
// silently gets the SSR (non-reactive) build, causing state updates to never
// propagate to the view. This was the root cause of mouse clicks not updating
// the sidebar after the initial refactor.
//
// All createSignal/createMemo/createEffect/onCleanup/onMount calls must live
// in .tsx files (typically the entry plugin file or component files).

const REACTIVE_PRIMITIVES = [
  "createSignal",
  "createMemo",
  "createEffect",
  "createRoot",
  "onCleanup",
  "onMount",
  "createRenderEffect",
  "createComputed",
  "runWithOwner",
  "createDisposable",
]

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listTsFiles(full))
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

describe("regression: no solid-js reactive primitives in .ts files", () => {
  test("no .ts file in plugins/ imports reactive primitives from solid-js", () => {
    const pluginsDir = join(import.meta.dir, "..", "..", "plugins")
    const tsFiles = listTsFiles(pluginsDir)

    const violations: string[] = []

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8")
      // Match: import { createSignal, ... } from "solid-js"
      const importMatch = content.match(/from\s+["']solid-js["']/)
      if (!importMatch) continue

      // Extract the imported names from the import statement(s)
      const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']solid-js["']/g
      let m: RegExpExecArray | null
      while ((m = importRegex.exec(content)) !== null) {
        const imported = m[1].split(",").map((s) => s.trim())
        for (const name of imported) {
          const cleaned = name.replace(/\s+as\s+.+/, "").trim()
          if (REACTIVE_PRIMITIVES.includes(cleaned)) {
            const rel = file.replace(pluginsDir + "/", "")
            violations.push(`${rel}: imports ${cleaned} from "solid-js"`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})
