// Preload: install the bun.spawn mock BEFORE any test file imports the source.
// The TUI source imports `spawn` from ./bun-utils (a thin wrapper around bun).
// We mock that wrapper so the source picks up our mock at import time.
import { installSpawnMock } from "./spawn-mock.ts"
installSpawnMock()
