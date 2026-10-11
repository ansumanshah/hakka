import { render, fireEvent } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommandPalette, type PaletteAction } from '../CommandPalette'

function q(container: HTMLElement, selector: string): Element | null {
  return container.querySelector(selector)
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Command palette live updates', () => {
  it('keeps a pressed command usable when live updates refresh its action', async () => {
    const initialRun = vi.fn()
    const latestRun = vi.fn()
    const onClose = vi.fn()
    const [actions, setActions] = createSignal<PaletteAction[]>([
      { id: 'tour', group: 'Actions', label: 'Show quick tour', run: initialRun },
    ])
    const { container } = render(() => <CommandPalette actions={actions()} onClose={onClose} />)
    await flush()
    const pressed = q(container, '[role="option"]') as HTMLButtonElement
    fireEvent.pointerDown(pressed)

    setActions([{ id: 'tour', group: 'Actions', label: 'Show quick tour', hint: 'updated', run: latestRun }])
    await flush()
    const current = q(container, '[role="option"]') as HTMLButtonElement
    expect(current).toBe(pressed)
    expect(current.textContent).toContain('updated')

    fireEvent.pointerUp(pressed)
    fireEvent.click(pressed)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(latestRun).toHaveBeenCalledTimes(1)
    expect(initialRun).not.toHaveBeenCalled()
  })

  it('preserves keyboard selection when live updates refresh the same commands', async () => {
    const firstRun = vi.fn()
    const initialSecondRun = vi.fn()
    const latestSecondRun = vi.fn()
    const onClose = vi.fn()
    const [actions, setActions] = createSignal<PaletteAction[]>([
      { id: 'clear', group: 'Actions', label: 'Clear captured requests', run: firstRun },
      { id: 'tour', group: 'Actions', label: 'Show quick tour', run: initialSecondRun },
    ])
    const { container } = render(() => <CommandPalette actions={actions()} onClose={onClose} />)
    await flush()
    const input = q(container, '.hakka-palette-input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await flush()
    expect(q(container, '[aria-selected="true"]')?.textContent).toContain('Show quick tour')

    setActions([
      { id: 'clear', group: 'Actions', label: 'Clear captured requests', run: firstRun },
      { id: 'tour', group: 'Actions', label: 'Show quick tour', hint: 'updated', run: latestSecondRun },
    ])
    await flush()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(latestSecondRun).toHaveBeenCalledTimes(1)
    expect(initialSecondRun).not.toHaveBeenCalled()
    expect(firstRun).not.toHaveBeenCalled()
  })
})
