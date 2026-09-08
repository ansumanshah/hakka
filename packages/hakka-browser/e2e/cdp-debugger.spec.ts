import { expect, test } from '@playwright/test'

import { CdpDebugger } from '../../hakka-cli/src/cdp/debugger.js'

test('CDP debugger reads real source, pauses at a line breakpoint, and resumes execution', async ({ page }) => {
  const session = await page.context().newCDPSession(page)
  const debuggerAdapter = new CdpDebugger(session)
  await debuggerAdapter.start()
  const source = [
    'window.runHakkaBreakpoint = () => {',
    "  const value = 'paused';",
    '  window.hakkaBreakpointValue = value;',
    '  return value;',
    '};',
    '//# sourceURL=http://hakka.test/hakka-breakpoint.js',
  ].join('\n')
  await page.addScriptTag({ content: source })

  await expect
    .poll(() => debuggerAdapter.listScripts().find((script) => script.url.endsWith('/hakka-breakpoint.js')))
    .toBeTruthy()
  const script = debuggerAdapter.listScripts().find((entry) => entry.url.endsWith('/hakka-breakpoint.js'))!
  expect((await debuggerAdapter.getScriptSource(script.scriptId)).source).toContain("const value = 'paused'")
  const breakpoint = await debuggerAdapter.setBreakpoint(script.scriptId, 1)

  const execution = page.evaluate(() => (window as unknown as { runHakkaBreakpoint(): string }).runHakkaBreakpoint())
  await expect.poll(() => debuggerAdapter.getPaused()?.callFrames[0]?.lineNumber).toBe(1)
  await debuggerAdapter.resume()
  await expect(execution).resolves.toBe('paused')
  await debuggerAdapter.removeBreakpoint(breakpoint.breakpointId)
  await session.detach()
})
