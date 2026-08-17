/**
 * SelectionViewModel — mirrors the test style of the web twin
 * (packages/hakka-browser/src/ui/viewModels/SelectionViewModel.test.ts), jest instead
 * of vitest. Covers the RN-only `toggleSelectMode` intent in addition to the
 * shared contract.
 */
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

  it('toggleSelectMode flips selectMode and clears selection when turning off', () => {
    const vm = createSelectionViewModel()
    vm.intents.toggleSelectMode()
    expect(vm.getSnapshot().selectMode).toBe(true)

    vm.intents.toggleSelectId('r1')
    expect(vm.getSnapshot().selectedIds.has('r1')).toBe(true)

    vm.intents.toggleSelectMode()
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
    const listener = jest.fn()
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

describe('snapshot identity (useSyncExternalStore contract)', () => {
  it('getSnapshot returns the same reference until a mutation', () => {
    const vm = createSelectionViewModel()
    expect(vm.getSnapshot()).toBe(vm.getSnapshot())
    vm.intents.setSelectMode(true)
    const after = vm.getSnapshot()
    expect(after).toBe(vm.getSnapshot())
    expect(after.selectMode).toBe(true)
  })
})
