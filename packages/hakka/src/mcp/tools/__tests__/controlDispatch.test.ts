import { describe, expect, test } from 'bun:test'

import type { ControlCommand } from 'hakka-core'

import { dispatch, type ControlSender } from '../controlDispatch'

class FakeSender implements ControlSender {
  connected = true
  sent: ControlCommand[] = []
  sendControl(cmd: ControlCommand): boolean {
    this.sent.push(cmd)
    return this.connected
  }
}

describe('dispatch — host-side send seam', () => {
  test('sends a host-to-device command', () => {
    const sender = new FakeSender()
    const ok = dispatch(sender, { kind: 'breakpoint.abort', pauseId: 'p1' })
    expect(ok).toBe(true)
    expect(sender.sent).toEqual([{ kind: 'breakpoint.abort', pauseId: 'p1' }])
  })

  test('refuses to send breakpoint.paused — a host must never construct a device-to-host command', () => {
    const sender = new FakeSender()
    const ok = dispatch(sender, {
      kind: 'breakpoint.paused',
      pauseId: 'p1',
      phase: 'request',
      device: 'ios-simulator',
      request: { url: 'https://api.example.com/x', method: 'GET', headers: {} },
    })
    expect(ok).toBe(false)
    expect(sender.sent).toHaveLength(0)
  })

  test('returns false and never sends when the command is malformed', () => {
    const sender = new FakeSender()
    // Empty pauseId is well-typed but fails parseControlCommand's validation — dispatch() must refuse it, not send it unchecked.
    const malformed: ControlCommand = { kind: 'breakpoint.resume', pauseId: '' }
    const ok = dispatch(sender, malformed)
    expect(ok).toBe(false)
    expect(sender.sent).toHaveLength(0)
  })
})
