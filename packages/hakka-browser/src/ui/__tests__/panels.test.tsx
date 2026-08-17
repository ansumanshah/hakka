import { render, fireEvent } from '@solidjs/testing-library'
import { mockEngine, ThrottleEngine, type NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { MockTab } from '../MockTab'
import { StatsTab } from '../StatsTab'
import { ThrottleTab } from '../ThrottleTab'

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    duration: 100,
    responseBodySize: 500,
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...over,
  } as NetworkRequest
}

describe('MockTab', () => {
  beforeEach(() => mockEngine.clearRules())
  afterEach(() => mockEngine.clearRules())

  it('adds, toggles, and removes a mock rule via the UI', async () => {
    const { container, getByLabelText } = render(() => <MockTab active={true} />)

    expect(container.textContent).toContain('No mock rules')

    // Add a rule. Solid 2 microtask-batches signal writes — flush() applies
    // the pattern draft before the Add click handler reads it.
    const input = getByLabelText('URL pattern') as HTMLInputElement
    fireEvent.input(input, { target: { value: '/api/users' } })
    await flush()
    fireEvent.click(getByLabelText('Add mock rule'))
    await flush()

    expect(mockEngine.getRules().length).toBe(1)
    expect(container.textContent).toContain('/api/users')

    fireEvent.click(getByLabelText('Disable rule'))
    await flush()
    expect(mockEngine.getRules()[0]?.enabled).toBe(false)

    const ruleId = mockEngine.getRules()[0]!.id
    fireEvent.click(getByLabelText(`Remove rule ${ruleId}`))
    await flush()
    expect(mockEngine.getRules().length).toBe(0)
  })

  it('gives the method-picker chip an uppercase method class (matches styles.ts .method-GET etc.)', () => {
    const { getByLabelText } = render(() => <MockTab active={true} />)
    const getChip = getByLabelText('Select method GET')
    expect(getChip.className).toContain('method-GET')
    expect(getChip.className).not.toContain('method-get')
  })
})

describe('ThrottleTab', () => {
  afterEach(() => ThrottleEngine.setProfile('none'))

  it('sets the throttle profile from a preset chip', () => {
    const { container } = render(() => <ThrottleTab active={true} />)
    const slow3g = Array.from(container.querySelectorAll('.hakka-chip')).find((c) =>
      /slow\s*3g/i.test(c.textContent ?? ''),
    ) as HTMLElement
    expect(slow3g).toBeTruthy()
    fireEvent.click(slow3g)
    expect(ThrottleEngine.current.profile).toBe('slow-3g')
    expect(container.textContent?.toLowerCase()).toContain('slow')
  })
})

describe('StatsTab', () => {
  let client: StoreClient
  beforeEach(() => {
    client = initStore({ forceInProcess: true })
  })
  afterEach(() => destroyStore())

  it('renders aggregate counts from captured requests', async () => {
    client.ingest(req({ id: 'a', status: 200 }))
    client.ingest(req({ id: 'b', status: 404, method: 'POST' }))
    const { container } = render(() => <StatsTab active={true} />)
    await flush()
    expect(container.textContent).toMatch(/2/)
    expect(container.textContent?.toLowerCase()).toMatch(/success|error|status/)
  })
})
