/**
 * SettingsViewModel — matches the isolation style of `FilterViewModel.test.ts`:
 * `cachedSettings`/`AsyncStorageModule`/`NetInfoModule`/`DeviceInfoModule` are
 * all module-level singletons (mirroring the real app's in-memory settings
 * cache), so each test resets the module registry and re-requires the view-model
 * fresh. Tests avoid `setDesktopConnect(true)`/`commitDesktopUrl` with
 * `desktopConnect` on, since those call `hakkaBridge.connect()` (a real
 * WebSocket attempt) — out of scope for a unit test of state/intents.
 */
import type { createSettingsViewModel as CreateSettingsViewModel } from '../SettingsViewModel'

function freshModule(): { createSettingsViewModel: typeof CreateSettingsViewModel } {
  jest.resetModules()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../SettingsViewModel')
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('SettingsViewModel', () => {
  it('defaults match SettingsPanel.tsx original useState initial values', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    const snap = vm.getSnapshot()
    expect(snap.maxRecords).toBe(500)
    expect(snap.maxAge).toBe(0)
    expect(snap.redactBody).toBe('')
    expect(snap.desktopConnect).toBe(false)
    expect(snap.desktopUrl).toBe('ws://localhost:8989')
    expect(snap.importVisible).toBe(false)
    expect(snap.importText).toBe('')
    expect(snap.importStatus).toBe('idle')
  })

  it('becomes loaded once the (mocked, AsyncStorage-less) settings load resolves', async () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    expect(vm.getSnapshot().loaded).toBe(false)
    await flush()
    expect(vm.getSnapshot().loaded).toBe(true)
  })

  it('setMaxRecordsDraft parses input, falling back to the current value on a falsy parse (matches the original `parseInt(v, 10) || maxRecords` quirk)', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.setMaxRecordsDraft('750')
    expect(vm.getSnapshot().maxRecords).toBe(750)
    vm.intents.setMaxRecordsDraft('not-a-number')
    expect(vm.getSnapshot().maxRecords).toBe(750) // unchanged
    vm.intents.setMaxRecordsDraft('0')
    expect(vm.getSnapshot().maxRecords).toBe(750) // 0 is falsy too — reverts
  })

  it('commitMaxRecords clamps to [10, 5000]', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.setMaxRecordsDraft('99999')
    vm.intents.commitMaxRecords()
    expect(vm.getSnapshot().maxRecords).toBe(5000)

    vm.intents.setMaxRecordsDraft('1')
    vm.intents.commitMaxRecords()
    expect(vm.getSnapshot().maxRecords).toBe(10)
  })

  it('setMaxAge applies immediately with no draft phase', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.setMaxAge(3600)
    expect(vm.getSnapshot().maxAge).toBe(3600)
  })

  it('commitRedactBody parses a comma-separated list and normalizes the display string', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.setRedactBodyDraft(' password ,  token,,ssn ')
    vm.intents.commitRedactBody()
    expect(vm.getSnapshot().redactBody).toBe('password, token, ssn')
  })

  it('setDesktopUrlDraft updates desktopUrl without a network attempt (desktopConnect stays false)', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.setDesktopUrlDraft('ws://192.168.1.5:8989')
    expect(vm.getSnapshot().desktopUrl).toBe('ws://192.168.1.5:8989')
    expect(vm.getSnapshot().desktopConnect).toBe(false)
  })

  it('refreshEnvironment recomputes envSections without throwing', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    const before = vm.getSnapshot().envSections
    expect(before.length).toBeGreaterThan(0)
    vm.intents.refreshEnvironment()
    expect(vm.getSnapshot().envSections.length).toBeGreaterThan(0)
  })

  it('openImportSession resets importText/importStatus and opens the modal', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.setImportText('leftover')
    vm.intents.openImportSession()
    const snap = vm.getSnapshot()
    expect(snap.importVisible).toBe(true)
    expect(snap.importText).toBe('')
    expect(snap.importStatus).toBe('idle')
  })

  it('closeImportSession hides the modal without clearing importText', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.openImportSession()
    vm.intents.setImportText('draft')
    vm.intents.closeImportSession()
    const snap = vm.getSnapshot()
    expect(snap.importVisible).toBe(false)
    expect(snap.importText).toBe('draft')
  })

  it('setImportText resets importStatus to idle as a side effect', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.importSession() // fails on empty text, sets importStatus 'error'
    expect(vm.getSnapshot().importStatus).toBe('error')
    vm.intents.setImportText('{}')
    expect(vm.getSnapshot().importStatus).toBe('idle')
  })

  it('importSession succeeds on a valid .hakka payload, ingests requests, and closes the modal', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    const payload = JSON.stringify({
      hakkaSession: 1,
      requests: [{ id: 'r1', url: 'https://api.example.com/x', method: 'GET', startTime: 0, timestamp: 0 }],
    })
    vm.intents.openImportSession()
    vm.intents.setImportText(payload)
    const result = vm.intents.importSession()
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.count).toBe(1)
    expect(vm.getSnapshot().importVisible).toBe(false)
  })

  it('importSession fails on invalid JSON and sets importStatus to error', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    vm.intents.setImportText('not json')
    const result = vm.intents.importSession()
    expect(result.status).toBe('error')
    expect(vm.getSnapshot().importStatus).toBe('error')
  })

  it('subscribe fires exactly once per intent call; unsubscribe stops notifications', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    const listener = jest.fn()
    const unsub = vm.subscribe(listener)

    vm.intents.setMaxAge(3600)
    expect(listener).toHaveBeenCalledTimes(1)
    vm.intents.setRedactBodyDraft('x')
    expect(listener).toHaveBeenCalledTimes(2)

    unsub()
    vm.intents.setMaxAge(0)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('destroy() unsubscribes the bridge status listener', () => {
    const { createSettingsViewModel } = freshModule()
    const vm = createSettingsViewModel()
    const listener = jest.fn()
    vm.subscribe(listener)
    listener.mockClear()

    vm.destroy()
    vm.intents.setMaxAge(3600) // still works after destroy — destroy only tears down the bridge subscription
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
