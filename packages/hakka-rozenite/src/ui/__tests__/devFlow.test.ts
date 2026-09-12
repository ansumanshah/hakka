import { describe, expect, it } from 'vitest'

import config from '../../../rozenite.config'

const flow = config.dev!.flows![0]!
type FlowContext = Parameters<typeof flow.run>[0]
type FlowMessage = ReturnType<FlowContext['getMessages']>[number]

const snapshotRequest: FlowMessage = {
  id: 'snapshot-request',
  direction: 'out',
  date: '2026-09-12T00:00:00.000Z',
  type: 'get-snapshot',
  payload: {},
}

async function runConfiguredFlow(hasQueuedRequest: boolean) {
  const actions: string[] = []
  const matchers: unknown[] = []
  const sent: Array<{ type: string; payload: unknown }> = []

  const context: FlowContext = {
    signal: new AbortController().signal,
    send(type, payload) {
      actions.push('send')
      sent.push({ type, payload })
    },
    onMessage() {
      return { remove() {} }
    },
    async waitForMessage(matcher) {
      actions.push('waitForMessage')
      matchers.push(matcher)
      return snapshotRequest
    },
    getMessages(matcher) {
      actions.push('getMessages')
      matchers.push(matcher)
      return hasQueuedRequest ? [snapshotRequest] : []
    },
  }

  await flow.run(context)
  return { actions, matchers, sent }
}

function expectValidRequest(sent: Array<{ type: string; payload: unknown }>) {
  expect(sent).toEqual([
    {
      type: 'request',
      payload: {
        id: 'dev-flow-1',
        url: 'https://api.example.com/v1/dev-flow-check',
        method: 'GET',
        status: 200,
        startTime: expect.any(Number),
        endTime: expect.any(Number),
        duration: 100,
        size: 256,
        contentType: 'application/json',
      },
    },
  ])
}

describe('configured Request snapshot dev flow', () => {
  it('replies to a snapshot request already recorded by the dev host', async () => {
    const result = await runConfiguredFlow(true)

    expect(result.actions).toEqual(['getMessages', 'send'])
    expect(result.matchers).toEqual([{ type: 'get-snapshot', direction: 'out' }])
    expectValidRequest(result.sent)
  })

  it('waits for an outgoing snapshot request before replying when none is queued', async () => {
    const result = await runConfiguredFlow(false)

    expect(result.actions).toEqual(['getMessages', 'waitForMessage', 'send'])
    expect(result.matchers).toEqual([
      { type: 'get-snapshot', direction: 'out' },
      { type: 'get-snapshot', direction: 'out' },
    ])
    expectValidRequest(result.sent)
  })
})
