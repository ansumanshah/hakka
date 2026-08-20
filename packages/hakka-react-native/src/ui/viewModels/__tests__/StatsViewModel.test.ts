/**
 * StatsViewModel — the one view-model in this directory that had no test.
 * Mirrors the style of its siblings, and covers the snapshot-identity rule
 * that the other slices share: `useSyncExternalStore` compares snapshots by
 * identity after every render, so a fresh object per `getSnapshot()` call
 * loops React into "Maximum update depth exceeded".
 */
import { createStatsViewModel } from '../StatsViewModel'

describe('StatsViewModel', () => {
  it('defaults to no domain filter and collapsed URLs', () => {
    const vm = createStatsViewModel()
    const snap = vm.getSnapshot()

    expect(snap.selectedDomain).toBeNull()
    expect(snap.showAllUrls).toBe(false)
  })

  it('selectDomain sets the filter', () => {
    const vm = createStatsViewModel()
    vm.intents.selectDomain('api.example.com')

    expect(vm.getSnapshot().selectedDomain).toBe('api.example.com')
  })

  it('selecting the already-selected domain clears the filter', () => {
    const vm = createStatsViewModel()
    vm.intents.selectDomain('api.example.com')
    vm.intents.selectDomain('api.example.com')

    expect(vm.getSnapshot().selectedDomain).toBeNull()
  })

  it('selecting a different domain replaces rather than clears', () => {
    const vm = createStatsViewModel()
    vm.intents.selectDomain('api.example.com')
    vm.intents.selectDomain('cdn.example.com')

    expect(vm.getSnapshot().selectedDomain).toBe('cdn.example.com')
  })

  it('selectDomain(null) on an empty filter stays null rather than toggling', () => {
    const vm = createStatsViewModel()
    vm.intents.selectDomain(null)

    expect(vm.getSnapshot().selectedDomain).toBeNull()
  })

  it('toggleShowAllUrls flips and flips back', () => {
    const vm = createStatsViewModel()
    vm.intents.toggleShowAllUrls()
    expect(vm.getSnapshot().showAllUrls).toBe(true)

    vm.intents.toggleShowAllUrls()
    expect(vm.getSnapshot().showAllUrls).toBe(false)
  })

  it('notifies subscribers on every intent', () => {
    const vm = createStatsViewModel()
    let notifications = 0
    const unsubscribe = vm.subscribe(() => {
      notifications += 1
    })

    vm.intents.selectDomain('api.example.com')
    vm.intents.toggleShowAllUrls()
    unsubscribe()
    vm.intents.toggleShowAllUrls()

    expect(notifications).toBe(2)
  })

  it('returns an identical snapshot until state changes', () => {
    const vm = createStatsViewModel()
    const first = vm.getSnapshot()

    expect(vm.getSnapshot()).toBe(first)

    vm.intents.toggleShowAllUrls()
    expect(vm.getSnapshot()).not.toBe(first)
  })

  it('the two slices are independent', () => {
    const vm = createStatsViewModel()
    vm.intents.toggleShowAllUrls()
    vm.intents.selectDomain('api.example.com')

    const snap = vm.getSnapshot()
    expect(snap.showAllUrls).toBe(true)
    expect(snap.selectedDomain).toBe('api.example.com')
  })
})
