import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { parseRuntimeControlMessage } from '../runtimeControl'

for (const name of ['hello', 'welcome', 'targets', 'request', 'applied', 'failed']) {
  test(`runtime control ${name} fixture preserves the wire contract`, () => {
    const frame = JSON.parse(
      readFileSync(new URL(`../../../../../fixtures/runtime-control/${name}.json`, import.meta.url), 'utf8'),
    )
    expect(parseRuntimeControlMessage(frame)).toEqual(frame)
  })
}
test('rejects false success, unsupported capabilities, hostile IDs and device-to-host commands', () => {
  expect(
    parseRuntimeControlMessage({
      type: 'control.result',
      payload: { commandId: 'x', targetId: 'y', status: 'applied', error: 'timeout' },
    }),
  ).toBeNull()
  expect(
    parseRuntimeControlMessage({
      type: 'runtime.hello',
      payload: { role: 'runtime', runtime: 'ios', protocolVersion: 1, capabilities: ['request.erase'] },
    }),
  ).toBeNull()
  expect(parseRuntimeControlMessage({ type: 'runtime.welcome', payload: { targetId: 'bad id' } })).toBeNull()
  expect(
    parseRuntimeControlMessage({
      type: 'control.request',
      payload: { commandId: 'x', targetId: 'y', timeoutMs: 0, command: { kind: 'mock.clear' } },
    }),
  ).toBeNull()
})
