import { expect, test } from 'bun:test'

import type { RuntimeControlMessage } from '../runtimeControl'
import { RuntimeControlReceiver } from '../RuntimeControlReceiver'

test('only applies its own targeted command and acknowledges after application', async () => {
  const sent: RuntimeControlMessage[] = []
  let applications = 0
  let finish!: (ok: boolean) => void
  const receiver = new RuntimeControlReceiver(
    'browser',
    ['mock.clear'],
    () => {
      applications++
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    (m) => sent.push(m),
  )
  receiver.hello()
  receiver.receive({ type: 'runtime.welcome', payload: { targetId: 'a' } })
  const command = {
    type: 'control.request',
    payload: { commandId: 'c', targetId: 'a', command: { kind: 'mock.clear' }, timeoutMs: 1000 },
  }
  receiver.receive({ ...command, payload: { ...command.payload, targetId: 'b' } })
  receiver.receive(command)
  receiver.receive(command)
  await Promise.resolve()
  expect(applications).toBe(1)
  expect(sent.filter((m) => m.type === 'control.result')).toHaveLength(0)
  finish(true)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(sent.at(-1)).toEqual({ type: 'control.result', payload: { commandId: 'c', targetId: 'a', status: 'applied' } })
})
