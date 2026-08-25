import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hakka } from '../../index'
import { breakpointEngine } from '../BreakpointEngine'

/**
 * Regression coverage for stop() flushing pending breakpoints: before this fix,
 * BreakpointEngine.resumeAll() had no production caller — a fetch/xhr parked in a
 * breakpoint pause when stop() tore down capture would hang forever, since nothing
 * ever resolved its pause promise.
 */

beforeEach(() => {
  breakpointEngine.resumeAll()
  breakpointEngine.clearBreakpoints()
})

afterEach(() => {
  breakpointEngine.resumeAll()
  breakpointEngine.clearBreakpoints()
  Hakka.stop()
})

describe('Hakka.stop() and pending breakpoints', () => {
  test('stop() resolves a request-phase pause instead of leaving it hanging forever', async () => {
    const pausePromise = breakpointEngine.pause('req_1', 'request', {
      url: 'https://api.example.com/x',
      method: 'GET',
      headers: {},
      body: null,
    })
    expect(breakpointEngine.hasPaused()).toBe(true)

    Hakka.stop()

    const action = await pausePromise
    expect(action.type).toBe('resume')
    expect(breakpointEngine.hasPaused()).toBe(false)
  })

  test('stop() resolves a response-phase pause too', async () => {
    const pausePromise = breakpointEngine.pause('req_2', 'response', {
      status: 200,
      headers: {},
      body: '{}',
    })

    Hakka.stop()

    const action = await pausePromise
    expect(action.type).toBe('resume')
  })

  test('stop() with no pending breakpoints is a no-op (does not throw)', () => {
    expect(breakpointEngine.hasPaused()).toBe(false)
    expect(() => Hakka.stop()).not.toThrow()
  })
})
