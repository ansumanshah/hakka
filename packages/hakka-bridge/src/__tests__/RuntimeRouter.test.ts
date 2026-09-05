import { expect, test } from 'bun:test'

import type { RuntimeControlMessage } from 'hakka-core'

import { RuntimeRouter } from '../RuntimeRouter'

test('targeting, spoofed/duplicate results, capability refusal, legacy peers and disconnect are explicit', () => {
  const router = new RuntimeRouter()
  const messages = new Map<string, RuntimeControlMessage[]>()
  for (const id of ['controller', 'a', 'b', 'legacy']) {
    messages.set(id, [])
    router.connect(id, (message) => messages.get(id)!.push(message))
  }
  const hello = (id: string, role: 'runtime' | 'controller') =>
    router.handle(id, {
      type: 'runtime.hello',
      payload: { role, runtime: 'browser', capabilities: ['mock.clear'], protocolVersion: 1 },
    })
  hello('controller', 'controller')
  hello('a', 'runtime')
  hello('b', 'runtime')
  const request = (commandId: string, targetId = 'a', kind = 'mock.clear') => ({
    type: 'control.request',
    payload: { commandId, targetId, command: { kind }, timeoutMs: 1000 },
  })
  router.handle('controller', request('first'))
  expect(messages.get('a')!.filter((m) => m.type === 'control.request')).toHaveLength(1)
  expect(messages.get('b')!.filter((m) => m.type === 'control.request')).toHaveLength(0)
  const applied = { type: 'control.result', payload: { commandId: 'first', targetId: 'a', status: 'applied' } }
  router.handle('b', applied)
  expect(messages.get('controller')!.filter((m) => m.type === 'control.result')).toHaveLength(0)
  router.handle('a', applied)
  router.handle('a', applied)
  router.handle('controller', request('first'))
  expect(messages.get('controller')!.filter((m) => m.type === 'control.result')).toHaveLength(1)
  expect(messages.get('a')!.filter((m) => m.type === 'control.request')).toHaveLength(1)
  router.handle('controller', request('legacy-request', 'legacy'))
  expect(messages.get('controller')!.at(-1)).toMatchObject({ payload: { error: 'legacy_unacknowledged' } })
  router.handle('controller', {
    type: 'control.request',
    payload: {
      commandId: 'unsupported',
      targetId: 'a',
      command: { kind: 'throttle.set', profile: 'none' },
      timeoutMs: 1000,
    },
  })
  expect(messages.get('controller')!.at(-1)).toMatchObject({ payload: { error: 'unsupported_capability' } })
  router.handle('controller', request('pending'))
  router.disconnect('a')
  expect(
    messages
      .get('controller')!
      .filter((m) => m.type === 'control.result')
      .at(-1),
  ).toMatchObject({ payload: { error: 'target_disconnected' } })
  router.close()
})

test('late responses after timeout cannot complete or reapply a command', async () => {
  const router = new RuntimeRouter()
  const replies: RuntimeControlMessage[] = []
  router.connect('c', (m) => replies.push(m))
  router.connect('a', () => {})
  router.handle('c', {
    type: 'runtime.hello',
    payload: { role: 'controller', runtime: 'unknown', capabilities: [], protocolVersion: 1 },
  })
  router.handle('a', {
    type: 'runtime.hello',
    payload: { role: 'runtime', runtime: 'ios', capabilities: ['mock.clear'], protocolVersion: 1 },
  })
  router.handle('c', {
    type: 'control.request',
    payload: { commandId: 'x', targetId: 'a', command: { kind: 'mock.clear' }, timeoutMs: 5 },
  })
  await new Promise((resolve) => setTimeout(resolve, 15))
  router.handle('a', { type: 'control.result', payload: { commandId: 'x', targetId: 'a', status: 'applied' } })
  expect(replies.filter((m) => m.type === 'control.result')).toEqual([
    { type: 'control.result', payload: { commandId: 'x', targetId: 'a', status: 'failed', error: 'timeout' } },
  ])
  router.close()
})
