import { beforeEach } from 'vitest'

/**
 * Clear persisted inspector UI state between tests.
 *
 * `ui/persist.ts` writes `UiState` (including `open`) to `localStorage` under
 * `hakka:ui`, and a fresh `<Inspector />` reads it on mount. Without this, one
 * test that opens the panel leaves every later test rendering an
 * already-open inspector — which, among other things, removes the floating
 * toggle button (`InspectorToggleButton` renders it only while closed), so
 * later tests query null and fail in ways that look nothing like the cause.
 *
 * This suite passed locally only because happy-dom under bun reports no
 * `localStorage`, making persistence a silent no-op; CI has it, so the leak
 * was real there and invisible here. Clearing unconditionally makes the
 * result the same either way.
 */
beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
