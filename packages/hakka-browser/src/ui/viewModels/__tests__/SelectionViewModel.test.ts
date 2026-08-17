import { describe, expect, it, vi } from 'vitest'

import { createSelectionViewModel } from '../SelectionViewModel'

describe('SelectionViewModel', () => {
  it('defaults to select mode off, empty selection', () => {
    const vm = createSelectionViewModel()
    const snap = vm.getSnapshot()
    expect(snap.selectMode).toBe(false)
    expect(snap.selectedIds.size).toBe(0)
  })

  it('toggleSelectId auto-enters select mode on the first selection', () => {
    const vm = createSelectionViewModel()
    vm.intents.toggleSelectId('r1')
    const snap = vm.getSnapshot()
    expect(snap.selectMode).toBe(true)
    expect(snap.selectedIds.has('r1')).toBe(true)
  })

  it('toggleSelectId round-trips: selecting then deselecting the same id', () => {
    const vm = createSelectionViewModel()
    vm.intents.toggleSelectId('r1')
    vm.intents.toggleSelectId('r2')
    vm.intents.toggleSelectId('r1')
    const snap = vm.getSnapshot()
    expect(snap.selectedIds.has('r1')).toBe(false)
    expect(snap.selectedIds.has('r2')).toBe(true)
    // Deselecting down to a non-empty set never turns select mode back off.
    expect(snap.selectMode).toBe(true)
  })

  it('setSelectMode(false) clears the selection', () => {
    const vm = createSelectionViewModel()
    vm.intents.toggleSelectId('r1')
    vm.intents.toggleSelectId('r2')
    vm.intents.setSelectMode(false)
    const snap = vm.getSnapshot()
    expect(snap.selectMode).toBe(false)
    expect(snap.selectedIds.size).toBe(0)
  })

  it('removeId drops one id without touching select mode', () => {
    const vm = createSelectionViewModel()
    vm.intents.toggleSelectId('r1')
    vm.intents.toggleSelectId('r2')
    vm.intents.removeId('r1')
    const snap = vm.getSnapshot()
    expect(snap.selectedIds.has('r1')).toBe(false)
    expect(snap.selectedIds.has('r2')).toBe(true)
    expect(snap.selectMode).toBe(true)
  })

  it('clearIds() empties the selection but leaves select mode untouched', () => {
    const vm = createSelectionViewModel()
    vm.intents.toggleSelectId('r1')
    vm.intents.clearIds()
    const snap = vm.getSnapshot()
    expect(snap.selectedIds.size).toBe(0)
    expect(snap.selectMode).toBe(true) // still on, unlike clear()
  })

  it('clear() resets both selectMode and selectedIds', () => {
    const vm = createSelectionViewModel()
    vm.intents.toggleSelectId('r1')
    vm.intents.clear()
    const snap = vm.getSnapshot()
    expect(snap.selectMode).toBe(false)
    expect(snap.selectedIds.size).toBe(0)
  })

  it('subscribe fires synchronously on each intent call; unsubscribe stops notifications', () => {
    const vm = createSelectionViewModel()
    const listener = vi.fn()
    const unsub = vm.subscribe(listener)

    vm.intents.toggleSelectId('r1')
    expect(listener).toHaveBeenCalledTimes(1)
    vm.intents.toggleSelectId('r2')
    expect(listener).toHaveBeenCalledTimes(2)

    unsub()
    vm.intents.toggleSelectId('r3')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
