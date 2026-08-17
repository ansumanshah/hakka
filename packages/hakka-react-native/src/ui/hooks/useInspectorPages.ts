import { useCallback, useMemo, useState } from 'react'

/** Which tab lights up for a given page; 'settings' maps to nothing (not a tab). */
export type InspectorPage = 'logs' | 'stats' | 'rules' | 'storage' | 'appLogs' | 'settings'

export interface InspectorPagesController {
  page: InspectorPage
  openLogs: () => void
  /** The tab strip's leftmost destination, not a "back" — the sheet is
   * already open when this fires, so unlike the other `open*` handlers it
   * does not call `openInspector`. */
  openNetwork: () => void
  openStats: () => void
  closeStats: () => void
  openRules: () => void
  closeRules: () => void
  openStorage: () => void
  closeStorage: () => void
  openAppLogs: () => void
  closeAppLogs: () => void
  openSettings: () => void
  closeSettings: () => void
}

/**
 * Drives which of the five tab pages (plus the Settings drill-down) shows
 * inside the inspector sheet — only one page is ever true at a time, so
 * every `open*` handler resets the other four first. `openInspector` is the
 * caller's hook to also force the sheet open (e.g. `setShowInspector(true)`);
 * pass a referentially stable callback so these handlers stay stable too.
 */
export function useInspectorPages(openInspector: () => void): InspectorPagesController {
  const [showStatsPage, setShowStatsPage] = useState(false)
  const [showRulesPage, setShowRulesPage] = useState(false)
  const [showStoragePage, setShowStoragePage] = useState(false)
  const [showAppLogsPage, setShowAppLogsPage] = useState(false)
  const [showSettingsPage, setShowSettingsPage] = useState(false)

  const openLogs = useCallback(() => {
    setShowStatsPage(false)
    setShowRulesPage(false)
    setShowStoragePage(false)
    setShowAppLogsPage(false)
    setShowSettingsPage(false)
    openInspector()
  }, [openInspector])

  const openNetwork = useCallback(() => {
    setShowStatsPage(false)
    setShowRulesPage(false)
    setShowStoragePage(false)
    setShowAppLogsPage(false)
    setShowSettingsPage(false)
  }, [])

  const openStats = useCallback(() => {
    setShowStatsPage(true)
    setShowRulesPage(false)
    setShowStoragePage(false)
    setShowAppLogsPage(false)
    setShowSettingsPage(false)
    openInspector()
  }, [openInspector])
  const closeStats = useCallback(() => setShowStatsPage(false), [])

  const openRules = useCallback(() => {
    setShowStatsPage(false)
    setShowRulesPage(true)
    setShowStoragePage(false)
    setShowAppLogsPage(false)
    setShowSettingsPage(false)
    openInspector()
  }, [openInspector])
  const closeRules = useCallback(() => setShowRulesPage(false), [])

  const openStorage = useCallback(() => {
    setShowStatsPage(false)
    setShowRulesPage(false)
    setShowStoragePage(true)
    setShowAppLogsPage(false)
    setShowSettingsPage(false)
    openInspector()
  }, [openInspector])
  const closeStorage = useCallback(() => setShowStoragePage(false), [])

  const openAppLogs = useCallback(() => {
    setShowStatsPage(false)
    setShowRulesPage(false)
    setShowStoragePage(false)
    setShowAppLogsPage(true)
    setShowSettingsPage(false)
    openInspector()
  }, [openInspector])
  const closeAppLogs = useCallback(() => setShowAppLogsPage(false), [])

  const openSettings = useCallback(() => {
    setShowStatsPage(false)
    setShowRulesPage(false)
    setShowStoragePage(false)
    setShowAppLogsPage(false)
    setShowSettingsPage(true)
    openInspector()
  }, [openInspector])
  const closeSettings = useCallback(() => setShowSettingsPage(false), [])

  const page: InspectorPage = showStatsPage
    ? 'stats'
    : showRulesPage
      ? 'rules'
      : showStoragePage
        ? 'storage'
        : showAppLogsPage
          ? 'appLogs'
          : showSettingsPage
            ? 'settings'
            : 'logs'

  // Memoized so callers can depend on `pages` as a whole (every field here is
  // itself individually stable) instead of poking at individual methods.
  return useMemo(
    () => ({
      page,
      openLogs,
      openNetwork,
      openStats,
      closeStats,
      openRules,
      closeRules,
      openStorage,
      closeStorage,
      openAppLogs,
      closeAppLogs,
      openSettings,
      closeSettings,
    }),
    [
      page,
      openLogs,
      openNetwork,
      openStats,
      closeStats,
      openRules,
      closeRules,
      openStorage,
      closeStorage,
      openAppLogs,
      closeAppLogs,
      openSettings,
      closeSettings,
    ],
  )
}
