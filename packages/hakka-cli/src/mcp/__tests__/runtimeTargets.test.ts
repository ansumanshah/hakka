import { expect, test } from 'bun:test'

import { startBridgeServer } from 'hakka-bridge'
import { RuntimeControlReceiver, type RuntimeCapability, type RuntimeControlMessage } from 'hakka-core'
import WebSocket from 'ws'

import { createBridgeListener } from '../bridgeListener'
import { RequestStore } from '../RequestStore'

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition did not become true')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

test('real bridge discovers peers, isolates target A, refuses legacy/unsupported control, and times out safely', async () => {
  const bridge = await startBridgeServer({ port: 0, advertise: false })
  const url = `ws://127.0.0.1:${bridge.port}`
  const sockets: WebSocket[] = []
  const applied = { a: 0, b: 0 }
  const runtime = (name: 'a' | 'b', capabilities: RuntimeCapability[]) => {
    const socket = new WebSocket(url)
    sockets.push(socket)
    const receiver = new RuntimeControlReceiver(
      'browser',
      capabilities,
      () => {
        applied[name]++
        return true
      },
      (message) => socket.send(JSON.stringify(message)),
    )
    socket.on('open', () => receiver.hello())
    socket.on('message', (raw) => receiver.receive(JSON.parse(raw.toString())))
  }
  runtime('a', ['mock.clear'])
  runtime('b', ['mock.clear'])
  const controller = createBridgeListener(new RequestStore(), url)
  try {
    await waitFor(() => controller.getTargets().filter((target) => target.acknowledged).length === 2)
    const [a, b] = controller.getTargets()
    expect((await controller.requestControl({ kind: 'mock.clear' })).error).toBe('target_required')
    expect((await controller.requestControl({ kind: 'mock.clear' }, a!.id)).status).toBe('applied')
    expect(applied.a + applied.b).toBe(1)
    expect((await controller.requestControl({ kind: 'throttle.set', profile: 'none' }, b!.id)).error).toBe(
      'unsupported_capability',
    )
    const legacy = new WebSocket(url)
    sockets.push(legacy)
    await waitFor(() => controller.getTargets().some((target) => !target.acknowledged))
    const old = controller.getTargets().find((target) => !target.acknowledged)!
    expect((await controller.requestControl({ kind: 'mock.clear' }, old.id)).error).toBe('legacy_unacknowledged')
    const slow = new WebSocket(url)
    sockets.push(slow)
    let slowId = ''
    let pending: RuntimeControlMessage | undefined
    slow.on('open', () =>
      slow.send(
        JSON.stringify({
          type: 'runtime.hello',
          payload: { role: 'runtime', runtime: 'android', capabilities: ['mock.clear'], protocolVersion: 1 },
        }),
      ),
    )
    slow.on('message', (raw) => {
      const frame = JSON.parse(raw.toString())
      if (frame.type === 'runtime.welcome') slowId = frame.payload.targetId
      if (frame.type === 'control.request') pending = frame
    })
    await waitFor(() => slowId !== '' && controller.getTargets().some((target) => target.id === slowId))
    expect((await controller.requestControl({ kind: 'mock.clear' }, slowId, 10)).error).toBe('timeout')
    if (pending?.type === 'control.request')
      slow.send(
        JSON.stringify({
          type: 'control.result',
          payload: { commandId: pending.payload.commandId, targetId: slowId, status: 'applied' },
        }),
      )
    pending = undefined
    const disconnected = controller.requestControl({ kind: 'mock.clear' }, slowId, 1000)
    await waitFor(() => pending?.type === 'control.request')
    slow.close()
    expect((await disconnected).error).toBe('target_disconnected')
  } finally {
    controller.close()
    for (const socket of sockets) socket.terminate()
    await bridge.close()
  }
})

test('real bridge returns bounded page inspection data and requires runtime edit opt-in', async () => {
  const bridge = await startBridgeServer({ port: 0, advertise: false })
  const url = `ws://127.0.0.1:${bridge.port}`
  const socket = new WebSocket(url)
  let editsEnabled = false
  let text = 'before'
  const receiver = new RuntimeControlReceiver(
    'browser',
    ['page.inspect', 'page.edit', 'page.undo'],
    (command) => {
      if (command.kind === 'page.inspect')
        return { ok: true, data: { elements: [{ selector: '#target', text: text.slice(0, 140) }] } }
      if (command.kind === 'page.edit') {
        if (!editsEnabled) return { ok: false }
        text = command.text ?? text
        return { ok: true, data: { changeId: 'page_1' } }
      }
      if (command.kind === 'page.undo') {
        text = 'before'
        return { ok: true, data: { undone: command.changeId } }
      }
      return false
    },
    (message) => socket.send(JSON.stringify(message)),
  )
  socket.on('open', () => receiver.hello())
  socket.on('message', (raw) => receiver.receive(JSON.parse(raw.toString())))
  const controller = createBridgeListener(new RequestStore(), url)
  try {
    await waitFor(() => controller.getTargets().some((target) => target.capabilities.includes('page.inspect')))
    const target = controller.getTargets()[0]!
    const inspected = await controller.requestControl({ kind: 'page.inspect', selector: '#target' }, target.id)
    expect(inspected.data).toEqual({ elements: [{ selector: '#target', text: 'before' }] })
    expect(
      (await controller.requestControl({ kind: 'page.edit', selector: '#target', text: 'after' }, target.id)).status,
    ).toBe('failed')
    expect(text).toBe('before')
    editsEnabled = true
    const edit = await controller.requestControl({ kind: 'page.edit', selector: '#target', text: 'after' }, target.id)
    expect(edit.data?.changeId).toBe('page_1')
    expect(text).toBe('after')
    await controller.requestControl({ kind: 'page.undo', changeId: 'page_1' }, target.id)
    expect(text).toBe('before')
  } finally {
    controller.close()
    socket.terminate()
    await bridge.close()
  }
})
