import { mock } from "bun:test"

export type SpawnHandler = (args: string[]) => {
  stdout?: string
  stderr?: string
  exitCode?: number
}

const spawnHandlers: SpawnHandler[] = []
let currentHandler: SpawnHandler | null = null

export function mockSpawn(handler: SpawnHandler) {
  currentHandler = handler
}

export function mockSpawnSequence(handlers: SpawnHandler[]) {
  spawnHandlers.push(...handlers)
}

export function clearSpawnMocks() {
  spawnHandlers.length = 0
  currentHandler = null
}

function makeMockProc(stdoutStr: string, stderrStr: string, exitCode: number) {
  const encoder = new TextEncoder()
  const stdoutStream = new ReadableStream({
    start(controller) {
      if (stdoutStr) controller.enqueue(encoder.encode(stdoutStr))
      controller.close()
    },
  })
  const stderrStream = new ReadableStream({
    start(controller) {
      if (stderrStr) controller.enqueue(encoder.encode(stderrStr))
      controller.close()
    },
  })
  // exited resolves after a macrotask delay so that pipeTo has time to
  // drain the closed streams before resolve() is called in the source.
  const exited = new Promise<number>((resolve) => {
    setTimeout(() => resolve(exitCode), 10)
  })
  return { stdout: stdoutStream, stderr: stderrStream, exited }
}

export function installSpawnMock() {
  // Try multiple path forms since bun's resolver may use different normalizations.
  const repoRoot = `${import.meta.dir}/../..`
  const candidates = [
    `${repoRoot}/plugins/bun-utils.ts`,
  ]

  for (const wrapperPath of candidates) {
    try {
  mock.module(wrapperPath, () => {
    return {
      spawn: (opts: { cmd: string[]; stdout?: string; stderr?: string }) => {
        let handler: SpawnHandler | undefined
        if (spawnHandlers.length > 0) {
          handler = spawnHandlers.shift()
        } else if (currentHandler) {
          handler = currentHandler
        }
        if (!handler) {
          throw new Error(
            `bun.spawn called with no mock: ${JSON.stringify(opts.cmd)}`,
          )
        }
        const result = handler(opts.cmd)
        return makeMockProc(
          result.stdout ?? "",
          result.stderr ?? "",
          result.exitCode ?? 0,
        ) as any
      },
    }
  })
    } catch (e) {
      console.error("[spawn-mock] failed for", wrapperPath, e)
    }
  }
}
