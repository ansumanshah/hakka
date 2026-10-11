import type { FilterViewModel } from './viewModels'

/** Remove constraints while keeping the current sorting and grouping preferences. */
export function resetRequestFilters(filters: FilterViewModel): void {
  const current = filters.getSnapshot()
  filters.intents.applyFilter({
    filterText: '',
    filterMethod: '',
    filterStatus: 'all',
    filterContentType: 'all',
    filterRuntime: 'all',
    sortField: current.sortField,
    sortOrder: current.sortOrder,
    groupBy: current.groupBy,
  })
}
