export type ShellHandler = (cmd: string, args: string[]) => {
  stdout?: string
  stderr?: string
  exitCode?: number
}

export class MockShell {
  private handlers: Array<{ matcher: RegExp | "any"; handler: ShellHandler }> = []

  on(pattern: RegExp | "any", handler: ShellHandler): this {
    this.handlers.push({ matcher: pattern, handler })
    return this
  }

  build() {
    const self = this
    const findHandler = (cmd: string) => {
      for (const h of self.handlers) {
        if (h.matcher === "any") return h.handler
        if (h.matcher instanceof RegExp && h.matcher.test(cmd)) return h.handler
      }
      return null
    }
    const makeChainable = (
      resolvedCmd: string,
      resolvedArgs: string[],
      cwd: string,
    ): any => {
      const chain = {
        cwd: (c: string) => {
          cwd = c
          return chain
        },
        text: async () => {
          const handler = findHandler(resolvedCmd)
          if (!handler) {
            throw new Error(
              `MockShell: no handler for command: ${resolvedCmd} ${resolvedArgs.join(" ")}`,
            )
          }
          const result = handler(resolvedCmd, resolvedArgs)
          if (result.exitCode !== undefined && result.exitCode !== 0) {
            const err = new Error(
              result.stderr || `exit code ${result.exitCode}`,
            ) as any
            err.exitCode = result.exitCode
            err.stderr = result.stderr
            throw err
          }
          return result.stdout ?? ""
        },
        json: async () => {
          const text = await chain.text()
          return JSON.parse(text)
        },
      }
      return chain
    }
    const tag = (strings: TemplateStringsArray, ...values: any[]) => {
      const parts: string[] = []
      for (let i = 0; i < strings.length; i++) {
        parts.push(strings[i])
        if (i < values.length) {
          const v = values[i]
          if (Array.isArray(v)) {
            parts.push(v.join(" "))
          } else if (v != null) {
            parts.push(String(v))
          }
        }
      }
      const full = parts.join("").trim()
      const match = full.match(/^(\S+)(.*)$/s) ?? ["", full, ""]
      const cmd = match[1] ?? ""
      const args = (match[2] ?? "").trim().split(/\s+/).filter(Boolean)
      return makeChainable(cmd, args, ".")
    }
    return tag as any
  }
}
