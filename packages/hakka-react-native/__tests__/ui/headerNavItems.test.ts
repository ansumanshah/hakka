import { NAV_ITEMS } from '../../src/ui/utils/headerNavItems'

// The tab strip must expose exactly the 5 fixed destinations — Network,
// Stats, Logs, Rules, Storage, in that order — with Settings (behind the
// header gear) and the standalone Console tab (merged into Logs via
// LogsTabView's internal segmented switch) both absent. Five fixed items is
// also why the strip never needs to scroll at phone widths; a 6th/7th item
// creeping back in is exactly the regression this guards.
describe('Header NAV_ITEMS (5-destination nav convergence)', () => {
  it('has exactly 5 destinations, in the spec order', () => {
    expect(NAV_ITEMS.map((item) => item.key)).toEqual(['network', 'stats', 'appLogs', 'rules', 'storage'])
  })

  it('labels the merged Logs destination "Logs", not "Console" or "Structured"', () => {
    const logsItem = NAV_ITEMS.find((item) => item.key === 'appLogs')
    expect(logsItem?.label).toBe('Logs')
  })

  it('never re-lists Settings or Console as separate tab-strip entries', () => {
    const keys = NAV_ITEMS.map((item) => item.key)
    expect(keys).not.toContain('settings')
    expect(keys).not.toContain('console')
  })
})
