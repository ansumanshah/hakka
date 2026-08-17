import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFilterViewModel } from '../FilterViewModel'

// localStorage mock — happy-dom doesn't provide one unless --localstorage-file is set.
function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? (store[key] as string) : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

const lsMock = makeLocalStorageMock()

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FilterViewModel', () => {
  it('defaults match Inspector.tsx today (time/desc/no group/empty text)', () => {
    const vm = createFilterViewModel()
    const snap = vm.getSnapshot()
    expect(snap.filterText).toBe('')
    expect(snap.sortField).toBe('time')
    expect(snap.sortOrder).toBe('desc')
    expect(snap.groupBy).toBe('none')
    expect(snap.advancedCount).toBe(0)
    expect(snap.hasRange).toBe(false)
  })

  it('setFilterText mutates the shared slice', () => {
    const vm = createFilterViewModel()
    vm.intents.setFilterText('status:>=400')
    expect(vm.getSnapshot().filterText).toBe('status:>=400')
    expect(vm.getSnapshot().filterDisplay).toBe('status:>=400')
  })

  it('NL mode extracts status/method fragments out of the free text', () => {
    const vm = createFilterViewModel()
    vm.intents.toggleNlMode()
    vm.intents.setFilterText('failed POST calls')
    const snap = vm.getSnapshot()
    expect(snap.nlMode).toBe(true)
    expect(snap.methodFilter).toBe('POST')
    // The raw NL text stays in the display box even though `filterText` (the
    // DSL predicate() consumes) is derived from it.
    expect(snap.filterDisplay).toBe('failed POST calls')
  })

  it('turning NL mode off resyncs the display box to the current DSL text', () => {
    const vm = createFilterViewModel()
    vm.intents.toggleNlMode()
    vm.intents.setFilterText('slow POSTs')
    vm.intents.toggleNlMode()
    expect(vm.getSnapshot().filterDisplay).toBe(vm.getSnapshot().filterText)
    expect(vm.getSnapshot().nlMode).toBe(false)
  })

  it('advancedCount reflects active advanced filters', () => {
    const vm = createFilterViewModel()
    expect(vm.getSnapshot().advancedCount).toBe(0)
    vm.intents.setContentType('json')
    expect(vm.getSnapshot().advancedCount).toBe(1)
    vm.intents.setGroupBy('host')
    expect(vm.getSnapshot().advancedCount).toBe(2)
    vm.intents.setDurMin(100)
    expect(vm.getSnapshot().advancedCount).toBe(3)
    expect(vm.getSnapshot().hasRange).toBe(true)
  })

  it('clearRange resets range fields without touching showRange', () => {
    const vm = createFilterViewModel()
    vm.intents.toggleShowRange()
    vm.intents.setDurMin(50)
    vm.intents.setSizeMaxKb(10)
    expect(vm.getSnapshot().hasRange).toBe(true)
    vm.intents.clearRange()
    const snap = vm.getSnapshot()
    expect(snap.hasRange).toBe(false)
    expect(snap.durMin).toBe(0)
    expect(snap.sizeMaxKb).toBe(0)
    expect(snap.showRange).toBe(true) // unaffected by clearRange
  })

  it('saveFilter / applyFilter / removeSavedFilter round-trip', () => {
    const vm = createFilterViewModel()
    vm.intents.setFilterText('host:api.example.com')
    vm.intents.setMethodFilter('POST')
    vm.intents.saveFilter('my filter')

    expect(vm.getSnapshot().savedFilters.map((f) => f.name)).toContain('my filter')

    // Reset local state, then re-apply the saved snapshot.
    vm.intents.setFilterText('')
    vm.intents.setMethodFilter('')
    const saved = vm.getSnapshot().savedFilters.find((f) => f.name === 'my filter')!
    vm.intents.applyFilter(saved.query)

    const snap = vm.getSnapshot()
    expect(snap.filterText).toBe('host:api.example.com')
    expect(snap.methodFilter).toBe('POST')

    vm.intents.removeSavedFilter('my filter')
    expect(vm.getSnapshot().savedFilters.map((f) => f.name)).not.toContain('my filter')
  })

  it('non-empty filterText changes push a recent-filter entry', () => {
    const vm = createFilterViewModel()
    vm.intents.setFilterText('dur>500')
    expect(vm.getSnapshot().recentFilters[0]?.filterText).toBe('dur>500')
  })

  it('subscribe fires exactly once per intent call, synchronously (no render lag vs. a raw Solid signal write)', () => {
    const vm = createFilterViewModel()
    const listener = vi.fn()
    vm.subscribe(listener)

    vm.intents.setMethodFilter('GET')
    expect(listener).toHaveBeenCalledTimes(1) // synchronous — no microtask wait needed

    vm.intents.setContentType('json')
    vm.intents.setGroupBy('host')
    expect(listener).toHaveBeenCalledTimes(3) // one per intent call, each touching several fields internally
  })

  it('unsubscribe stops further notifications', () => {
    const vm = createFilterViewModel()
    const listener = vi.fn()
    const unsub = vm.subscribe(listener)

    vm.intents.setMethodFilter('GET')
    expect(listener).toHaveBeenCalledTimes(1)

    unsub()
    vm.intents.setMethodFilter('POST')
    expect(listener).toHaveBeenCalledTimes(1) // unchanged
  })
})

describe('FilterViewModel — verboseSpans (Next Request Insights design doc feature 5)', () => {
  it('defaults to false and setVerboseSpans flips + persists it, surviving a fresh instance', () => {
    const vm = createFilterViewModel()
    expect(vm.getSnapshot().verboseSpans).toBe(false)

    vm.intents.setVerboseSpans(true)
    expect(vm.getSnapshot().verboseSpans).toBe(true)

    // Persisted like sortField/groupBy — a fresh instance (a page reload) restores it.
    const fresh = createFilterViewModel()
    expect(fresh.getSnapshot().verboseSpans).toBe(true)
  })

  it('setVerboseSpans notifies subscribers', () => {
    const vm = createFilterViewModel()
    const listener = vi.fn()
    vm.subscribe(listener)

    vm.intents.setVerboseSpans(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
