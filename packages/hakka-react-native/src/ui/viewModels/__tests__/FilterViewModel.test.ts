/**
 * FilterViewModel — mirrors the test style of the web twin
 * (packages/hakka-browser/src/ui/viewModels/FilterViewModel.test.ts), jest instead of
 * vitest.
 *
 * `../utils/filterPersist` holds its saved/recent state in a module-level
 * singleton (same as the real app — an in-memory cache seeded from
 * AsyncStorage). Each test resets the module registry and re-requires
 * `FilterViewModel` fresh so that singleton never leaks state between cases.
 */
import type { createFilterViewModel as CreateFilterViewModel } from '../FilterViewModel'

function freshModule(): { createFilterViewModel: typeof CreateFilterViewModel } {
  jest.resetModules()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../FilterViewModel')
}

describe('FilterViewModel', () => {
  it('defaults match HakkaInspector.tsx original useState initial values', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    const snap = vm.getSnapshot()
    expect(snap.filter).toBe('')
    expect(snap.effectiveFilter).toBe('')
    expect(snap.showFilters).toBe(false)
    expect(snap.statusGroup).toBe('all')
    expect(snap.methodFilters.size).toBe(0)
    expect(snap.sortDesc).toBe(true)
    expect(snap.searchInBody).toBe(false)
    expect(snap.nlMode).toBe(false)
    expect(snap.selectedDomains.size).toBe(0)
    expect(snap.groupBy).toBe('none')
    expect(snap.sortBy).toBe('time')
    expect(snap.sortDir).toBe('desc')
    expect(snap.savedFilters).toEqual([])
    expect(snap.recentFilters).toEqual([])
  })

  it('setFilter updates filter and effectiveFilter passes through verbatim outside NL mode', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.setFilter('status:500')
    const snap = vm.getSnapshot()
    expect(snap.filter).toBe('status:500')
    expect(snap.effectiveFilter).toBe('status:500')
  })

  it('setNlMode compiles the raw text through nlToQuery for effectiveFilter only', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.setNlMode(true)
    vm.intents.setFilter('errors')
    const snap = vm.getSnapshot()
    expect(snap.nlMode).toBe(true)
    expect(snap.filter).toBe('errors') // raw text preserved
    expect(snap.effectiveFilter).toBe('status:>=400') // compiled via nlToQuery
  })

  it('toggleMethod toggles set membership', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.toggleMethod('GET')
    expect(vm.getSnapshot().methodFilters.has('GET')).toBe(true)
    vm.intents.toggleMethod('GET')
    expect(vm.getSnapshot().methodFilters.has('GET')).toBe(false)
  })

  it('toggleDomain toggles set membership and does not touch saved/recent filters', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.toggleDomain('api.example.com')
    const snap = vm.getSnapshot()
    expect(snap.selectedDomains.has('api.example.com')).toBe(true)
    expect(snap.recentFilters).toEqual([])
  })

  it('toggleSortDesc and toggleFilters flip their own flags without pushing to recentFilters', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.toggleSortDesc()
    vm.intents.toggleFilters()
    const snap = vm.getSnapshot()
    expect(snap.sortDesc).toBe(false)
    expect(snap.showFilters).toBe(true)
    expect(snap.recentFilters).toEqual([])
  })

  it('setFilter with non-empty text pushes a snapshot onto recentFilters', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.setFilter('host:api.example.com')
    const snap = vm.getSnapshot()
    expect(snap.recentFilters).toHaveLength(1)
    expect(snap.recentFilters[0]?.query).toBe('host:api.example.com')
  })

  it('setFilter back to empty (with methodFilters empty and statusGroup all) does not push to recentFilters', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.setFilter('x')
    vm.intents.setFilter('')
    // Only the first, non-empty call should have pushed.
    expect(vm.getSnapshot().recentFilters).toHaveLength(1)
    expect(vm.getSnapshot().recentFilters[0]?.query).toBe('x')
  })

  it('toggleMethod alone (empty filter, statusGroup all) still pushes — matches the original effect guard', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.toggleMethod('POST')
    const snap = vm.getSnapshot()
    expect(snap.recentFilters).toHaveLength(1)
    expect(snap.recentFilters[0]?.methodFilters).toEqual(['POST'])
  })

  it('applyFilter restores a full snapshot in one call', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.applyFilter({
      query: 'status:200',
      methodFilters: ['GET', 'POST'],
      statusGroup: '2xx',
      sortBy: 'duration',
      sortDir: 'asc',
      groupBy: 'host',
    })
    const snap = vm.getSnapshot()
    expect(snap.filter).toBe('status:200')
    expect([...snap.methodFilters].sort()).toEqual(['GET', 'POST'])
    expect(snap.statusGroup).toBe('2xx')
    expect(snap.sortBy).toBe('duration')
    expect(snap.sortDir).toBe('asc')
    expect(snap.groupBy).toBe('host')
  })

  it('saveFilter adds a named entry to savedFilters', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.setFilter('slow')
    vm.intents.saveFilter('my-filter')
    const snap = vm.getSnapshot()
    expect(snap.savedFilters).toHaveLength(1)
    expect(snap.savedFilters[0]?.name).toBe('my-filter')
    expect(snap.savedFilters[0]?.snapshot.query).toBe('slow')
  })

  it('removeSavedFilter removes a previously saved entry', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    vm.intents.saveFilter('to-remove')
    expect(vm.getSnapshot().savedFilters).toHaveLength(1)
    vm.intents.removeSavedFilter('to-remove')
    expect(vm.getSnapshot().savedFilters).toHaveLength(0)
  })

  it('subscribe fires exactly once per intent call; unsubscribe stops notifications', () => {
    const { createFilterViewModel } = freshModule()
    const vm = createFilterViewModel()
    const listener = jest.fn()
    const unsub = vm.subscribe(listener)

    vm.intents.setFilter('a')
    expect(listener).toHaveBeenCalledTimes(1)
    vm.intents.toggleMethod('GET')
    expect(listener).toHaveBeenCalledTimes(2)

    unsub()
    vm.intents.toggleSortDesc()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
