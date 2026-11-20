/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { DashboardView } from "../../plugins/app/DashboardView"
import { dashboardOptions } from "../../plugins/app/config"
import { okState, loadingState } from "../helpers/state-fixtures"
import { createMockTuiApi } from "../helpers/tui-api-mock"

describe("DashboardView reactivity", () => {
  test("re-renders when state signal updates from loading to ok", async () => {
    const { api } = createMockTuiApi()
    const [state, setState] = createSignal(loadingState())

    const r = await testRender(
      () => (
        <DashboardView
          theme={api.theme}
          state={state()}
          setSelectedIdx={() => {}}
          onOpen={() => {}}
          scope="branch"
          statusFilter="open"
          onCycleScope={() => {}}
          onCycleStatus={() => {}}
          onLoadMore={async () => {}}
          pageSize={dashboardOptions().pageSize}
          colors={dashboardOptions().colors}
          icons={dashboardOptions().icons}
          spacing={dashboardOptions().spacing}
          showSingleStatusCount={dashboardOptions().showSingleStatusCount}
        />
      ),
      { width: 80, height: 30 },
    )

    await r.flush()
    const before = r.captureCharFrame()
    expect(before).toContain("Loading")
    expect(before).not.toContain("✓")

    setState(okState())
    await r.flush()
    const after = r.captureCharFrame()

    expect(after).not.toContain("Loading")
    expect(after).toContain("+42")
    expect(after).toContain("●")
  })
})
