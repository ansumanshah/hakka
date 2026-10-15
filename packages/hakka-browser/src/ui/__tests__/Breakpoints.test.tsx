import { render, fireEvent } from '@solidjs/testing-library'
import { breakpointEngine } from 'hakka-core'
import { flush } from 'solid-js'
import { afterEach, describe, expect, it } from 'vitest'

import { BreakpointsTab } from '../BreakpointsTab'

afterEach(() => {
  breakpointEngine.resumeAll()
  breakpointEngine.clearBreakpoints()
})

describe('BreakpointsTab', () => {
  // Solid 2 microtask-batches signal writes — `flush()` applies each write
  // (form input, engine subscriber notification) before the next read, same
  // as the "settle-gap" resync elsewhere in this migration.

  it('adds a breakpoint rule via the form', async () => {
    const { container, getByLabelText } = render(() => <BreakpointsTab active={true} />)
    fireEvent.input(getByLabelText('Breakpoint URL pattern') as HTMLInputElement, { target: { value: '/api/pay' } })
    await flush()
    fireEvent.click(getByLabelText('Add breakpoint'))
    await flush()
    expect(breakpointEngine.getBreakpoints().length).toBe(1)
    expect(container.textContent).toContain('/api/pay')
  })

  it('shows a paused request and resumes it from the panel', async () => {
    const { container, getByLabelText } = render(() => <BreakpointsTab active={true} />)
    // simulate a paused request (as the interceptor would)
    let resolved: unknown = null
    void breakpointEngine
      .pause('req1', 'request', { url: 'https://x.com/checkout', method: 'GET', headers: {}, body: null })
      .then((a) => (resolved = a))
    await flush()

    expect(container.textContent).toContain('Paused')
    const urlInput = getByLabelText('Edit paused URL') as HTMLInputElement
    expect(urlInput.value).toBe('https://x.com/checkout')

    fireEvent.input(urlInput, { target: { value: 'https://x.com/checkout?edited=1' } })
    await flush()
    fireEvent.click(getByLabelText('Resume paused request'))
    await flush()
    expect(breakpointEngine.getPaused().length).toBe(0)
    // the resume carried the edited URL
    await Promise.resolve()
    // Only the field the user changed is sent; the untouched body preview is not echoed back.
    expect(resolved).toEqual({ type: 'resume', edits: { url: 'https://x.com/checkout?edited=1' } })
  })

  it('resumes an unedited paused request without echoing the redacted body preview', async () => {
    const { getByLabelText } = render(() => <BreakpointsTab active={true} />)
    let resolved: unknown = null
    void breakpointEngine
      .pause('req3', 'request', {
        url: 'https://x.com/login',
        method: 'POST',
        headers: {},
        body: '{"password":"[REDACTED]"}',
      })
      .then((a) => (resolved = a))
    await flush()
    fireEvent.click(getByLabelText('Resume paused request'))
    await flush()
    await Promise.resolve()
    expect(resolved).toEqual({ type: 'resume', edits: {} })
  })

  it('sends an edited request body', async () => {
    const { getByLabelText } = render(() => <BreakpointsTab active={true} />)
    let resolved: unknown = null
    void breakpointEngine
      .pause('req4', 'request', { url: 'https://x.com/login', method: 'POST', headers: {}, body: '{"a":1}' })
      .then((a) => (resolved = a))
    await flush()
    fireEvent.input(getByLabelText('Edit paused body'), { target: { value: '{"a":2}' } })
    await flush()
    fireEvent.click(getByLabelText('Resume paused request'))
    await flush()
    await Promise.resolve()
    expect(resolved).toEqual({ type: 'resume', edits: { body: '{"a":2}' } })
  })

  it('aborts a paused request', async () => {
    const { getByLabelText } = render(() => <BreakpointsTab active={true} />)
    let resolved: unknown = null
    void breakpointEngine
      .pause('req2', 'request', { url: 'https://x.com/kill', method: 'GET', headers: {}, body: null })
      .then((a) => (resolved = a))
    await flush()
    fireEvent.click(getByLabelText('Abort paused request'))
    await flush()
    expect(breakpointEngine.getPaused().length).toBe(0)
    await Promise.resolve()
    expect(resolved).toEqual({ type: 'abort' })
  })

  it('adds a response-phase breakpoint via the phase selector', async () => {
    const { getByLabelText } = render(() => <BreakpointsTab active={true} />)
    fireEvent.input(getByLabelText('Breakpoint URL pattern') as HTMLInputElement, { target: { value: '/api/pay' } })
    await flush()
    fireEvent.click(getByLabelText('Select phase response'))
    await flush()
    fireEvent.click(getByLabelText('Add breakpoint'))
    await flush()
    const bps = breakpointEngine.getBreakpoints()
    expect(bps.length).toBe(1)
    expect(bps[0]?.on).toBe('response')
  })

  it('shows a paused response with response editors and resumes with an edited status', async () => {
    const { container, getByLabelText } = render(() => <BreakpointsTab active={true} />)
    let resolved: unknown = null
    void breakpointEngine
      .pause('res1', 'response', { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' })
      .then((a) => (resolved = a))
    await flush()

    expect(container.textContent).toContain('Paused')
    const statusInput = getByLabelText('Edit paused status') as HTMLInputElement
    expect(statusInput.value).toBe('200')
    expect(getByLabelText('Edit paused response headers')).toBeTruthy()
    expect(getByLabelText('Edit paused response body')).toBeTruthy()

    fireEvent.input(statusInput, { target: { value: '500' } })
    await flush()
    fireEvent.click(getByLabelText('Resume paused request'))
    await flush()
    expect(breakpointEngine.getPaused().length).toBe(0)
    await Promise.resolve()
    expect(resolved).toEqual({ type: 'resume', edits: { status: 500 } })
  })

  it('aborts a paused response', async () => {
    const { getByLabelText } = render(() => <BreakpointsTab active={true} />)
    let resolved: unknown = null
    void breakpointEngine.pause('res2', 'response', { status: 200, headers: {}, body: '' }).then((a) => (resolved = a))
    await flush()
    fireEvent.click(getByLabelText('Abort paused request'))
    await flush()
    expect(breakpointEngine.getPaused().length).toBe(0)
    await Promise.resolve()
    expect(resolved).toEqual({ type: 'abort' })
  })

  it('gives the method-picker chip an uppercase method class (matches styles.ts .method-GET etc.)', () => {
    const { getByLabelText } = render(() => <BreakpointsTab active={true} />)
    const getChip = getByLabelText('Select method GET')
    expect(getChip.className).toContain('method-GET')
    expect(getChip.className).not.toContain('method-get')
  })
})
