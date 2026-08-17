/**
 * Detail surfaces plugin-contributed context-menu items (Hakka.getContextMenuItems)
 * as action buttons that run against the selected request.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import { Hakka, type NetworkRequest } from 'hakka-core'
import { describe, it, expect, vi, afterEach } from 'vitest'

import { Detail } from '../Detail'

const req: NetworkRequest = {
  id: 'r1',
  url: 'https://api.example.com/users',
  method: 'GET',
  status: 200,
  startTime: 1,
}

afterEach(() => vi.restoreAllMocks())

describe('Detail — plugin context-menu items', () => {
  it('renders a contributed item and runs it against the request', () => {
    const run = vi.fn()
    vi.spyOn(Hakka, 'getContextMenuItems').mockReturnValue([{ id: 'annotate', label: 'Annotate', run }])

    const { getByText } = render(() => <Detail req={req} onBack={() => {}} />)
    fireEvent.click(getByText('Annotate'))

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(req)
  })

  it('renders no extra action buttons when no plugins contribute', () => {
    vi.spyOn(Hakka, 'getContextMenuItems').mockReturnValue([])
    const { queryByText } = render(() => <Detail req={req} onBack={() => {}} />)
    expect(queryByText('Annotate')).toBeNull()
  })
})
