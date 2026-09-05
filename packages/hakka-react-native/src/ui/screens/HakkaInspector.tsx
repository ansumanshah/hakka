import BottomSheet, { BottomSheetBackdrop, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet'
import { Hakka, exportHarString } from 'hakka-core'
import type { BubbleConfig, InspectorVisibility, ShakeConfig } from 'hakka-core'
import { extractHost, getUniqueDomains } from 'hakka-core'
import React, {
  createRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Alert, Share, Text, View, useColorScheme, useWindowDimensions } from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'

import { useHakka } from '../../hooks/useHakka'
import { useNetworkLogs } from '../../hooks/useNetworkLogs'
import { CrashBoundary } from '../CrashBoundary'
import { useBubbleDrag } from '../hooks/useBubbleDrag'
import { useBubbleGeometry } from '../hooks/useBubbleGeometry'
import { useBulkRequestExport } from '../hooks/useBulkRequestExport'
import { useInspectorPages } from '../hooks/useInspectorPages'
import { useMonitorRuntimeMetrics } from '../hooks/useMonitorRuntimeMetrics'
import { useSafeAreaInsets } from '../hooks/useSafeArea'
import { useShakeDetection } from '../hooks/useShakeDetection'
import { SheetScrollableInjector } from '../hooks/useSheetScrollable'
import { ThemeProvider, useTheme } from '../styles'
import { darkColors } from '../styles/tokens'
import { readableMonitorLabel } from '../utils/format'
import { lightImpact } from '../utils/haptics'
import { createMonitorHudModel, createMonitorSummary } from '../utils/monitorSummary'
import { createFilterViewModel, createSelectionViewModel } from '../viewModels'
import { ensureConsoleCapture } from './ConsolePanel'
import { InspectorContent } from './HakkaInspectorContent'
import { FloatingMonitorHud, type BubbleHudMode } from './HakkaInspectorFloatingHud'
import { createStyles } from './HakkaInspectorStyles'

// Spec range is 3-5; 4 keeps the expanded HUD under half a screen (~20px/row).
const RECENT_REQUESTS_COUNT = 4
const WRAPPER_ROOT_STYLE = { flex: 1 } as const
const DEFAULT_SHAKE_CONFIG: ShakeConfig = {}
const DEFAULT_BUBBLE_CONFIG: BubbleConfig = {}

namespace HakkaInspector {
  interface Methods {
    isVisible(): boolean
    show(): void
    hide(): void
    showInspector(): void
    hideInspector(): void
    getVisibility(): InspectorVisibility
  }

  export interface WrapperProps {
    /** Display mode: 'bubble' (draggable bubble), 'invisible' (shake-only), or 'fullscreen' (always fullscreen) */
    mode?: 'bubble' | 'invisible' | 'fullscreen'
    shake?: ShakeConfig
    /** Only applies in 'bubble' mode. */
    bubble?: BubbleConfig
    showExportButton?: boolean
    /** Defaults to 'dark', not 'system' — a bare device default frequently
     * disagrees with a host app's own theme. Pass 'system' to follow the
     * device setting, or 'light' to force light. */
    theme?: 'light' | 'dark' | 'system'
    /** Defaults to false. */
    disabled?: boolean
    children: ReactNode
    limit?: number
    onClose?: () => void
    onExport?: () => void
  }

  const ref = createRef<Methods>()

  export const isVisible = (): boolean => ref.current?.isVisible() ?? false

  export const show = (): void => ref.current?.show()

  export const hide = (): void => ref.current?.hide()

  export const showInspector = (): void => ref.current?.showInspector()

  export const hideInspector = (): void => ref.current?.hideInspector()

  export const getVisibility = (): InspectorVisibility | null => {
    return ref.current?.getVisibility() ?? null
  }

  const InspectorUI = memo(
    ({
      mode = 'bubble',
      shake = DEFAULT_SHAKE_CONFIG,
      bubble = DEFAULT_BUBBLE_CONFIG,
      showExportButton = false,
      limit = 1000,
      onClose,
      onExport,
    }: Omit<WrapperProps, 'children' | 'disabled' | 'theme'>) => {
      const shakeEnabled = shake.enabled ?? true
      const shakeSensitivity = shake.sensitivity ?? 1.2
      const minShakes = shake.minShakes ?? 1
      const shakeTimeWindow = shake.timeWindow ?? 1000

      const showBubbleOnInit = bubble.showOnInit ?? false
      const { isReady } = useHakka()
      const safeAreaInsets = useSafeAreaInsets()
      const theme = useTheme()
      const { colors } = theme
      const styles = createStyles(theme)
      const { width: screenWidth, height: screenHeight } = useWindowDimensions()
      const { bubbleHeight, bubbleWidth, initialBubblePosition } = useBubbleGeometry(
        bubble,
        safeAreaInsets,
        screenWidth,
      )
      // Ref for the non-fullscreen sheet — see the showInspector <-> sheet-index sync effect below.
      const sheetRef = useRef<BottomSheet>(null)
      // Numeric pixel snap points, not percentage strings — percentage strings
      // combined with enableDynamicSizing={false} silently fail to open under
      // this repo's reanimated/worklets/gesture-handler stack.
      const sheetSnapPoints = useMemo(
        () => [Math.round(screenHeight * 0.6), Math.round(screenHeight * 0.92)],
        [screenHeight],
      )

      const [showBubble, setShowBubble] = useState(mode === 'bubble' && showBubbleOnInit)
      const [showInspector, setShowInspector] = useState(mode === 'fullscreen')
      const [showHideZone, setShowHideZone] = useState(false)
      const [isDragging, setIsDragging] = useState(false)
      // Independent of `showInspector`: tap never opens the sheet, only
      // long-press does (see the reset effect and useBubbleDrag below).
      const [bubbleHudMode, setBubbleHudMode] = useState<BubbleHudMode>('collapsed')
      const [isDetailsOpen, setIsDetailsOpen] = useState(false)
      const monitorActive = showBubble || showInspector

      const { logs, totalCount } = useNetworkLogs({ enabled: monitorActive, limit })

      const scale = useSharedValue(1)

      const [isPaused, setIsPaused] = useState(() => Hakka.isPaused)

      const handleTogglePause = useCallback(() => {
        if (Hakka.isPaused) {
          Hakka.resume()
          setIsPaused(false)
        } else {
          Hakka.pause()
          setIsPaused(true)
        }
      }, [])

      // Mirrors the web Inspector.tsx twin (ADR 0003). Each view-model is
      // created once and consumed via useSyncExternalStore; `intents` is a
      // stable reference, so JSX wires directly to it without a useCallback per handler.
      const [filtersVm] = useState(() => createFilterViewModel())
      const filterSnap = useSyncExternalStore(filtersVm.subscribe, filtersVm.getSnapshot)

      const [selectionVm] = useState(() => createSelectionViewModel())
      const selectionSnap = useSyncExternalStore(selectionVm.subscribe, selectionVm.getSnapshot)

      const domains = useMemo(() => getUniqueDomains(logs), [logs])

      // Alert is a UI side effect, so it stays here rather than in the view-model.
      const handleSaveFilter = useCallback(() => {
        const name = filterSnap.filter.trim() || `filter-${Date.now()}`
        filtersVm.intents.saveFilter(name)
        Alert.alert('Filter Saved', `Saved as "${name}"`)
      }, [filterSnap.filter, filtersVm])

      const {
        exportHar: handleBulkExportHar,
        exportPostman: handleBulkExportPostman,
        exportOtel: handleBulkExportOtel,
      } = useBulkRequestExport(logs, selectionSnap.selectedIds)

      // `logs` is already newest-first (RingBuffer.getAll()), so this is a
      // plain head-slice, no re-sort needed.
      const recentRequests = useMemo(() => logs.slice(0, RECENT_REQUESTS_COUNT), [logs])

      // Every "open a page" handler also forces the sheet open; kept as a
      // stable callback so the page handlers built on it (and anything that
      // depends on their identity, like the bubble's long-press gesture) stay
      // stable too.
      const openInspectorSheet = useCallback(() => setShowInspector(true), [])
      const pages = useInspectorPages(openInspectorSheet)

      const handleBubbleLongPress = useCallback(() => {
        pages.openLogs()
      }, [pages])

      const handleBubbleToggleExpand = useCallback(() => {
        setBubbleHudMode((previous) => (previous === 'collapsed' ? 'expanded' : 'collapsed'))
        scale.value = withSequence(withTiming(0.96, { duration: 100 }), withTiming(1, { duration: 100 }))
      }, [scale])

      // Collapse back to default whenever the bubble leaves screen or the
      // sheet covers it, so it never reappears mid-expansion from stale state.
      useEffect(() => {
        if (!showBubble || showInspector) setBubbleHudMode('collapsed')
      }, [showBubble, showInspector])

      const handleDragStart = useCallback(() => setIsDragging(true), [])
      const handleDragEnd = useCallback(() => {
        setIsDragging(false)
        setShowHideZone(false)
      }, [])
      const handleHideZoneEnter = useCallback(() => setShowHideZone(true), [])
      const handleHideZoneExit = useCallback(() => setShowHideZone(false), [])
      const handleHideZoneDrop = useCallback(() => {
        setShowHideZone(false)
        setIsDragging(false)
        setShowBubble(false)
      }, [])

      // The sheet is the single source of truth for its own open/closed index
      // once mounted; every close path funnels through gorhom's own
      // gesture/close machinery, so `onChange` below is the one place that
      // syncs `showInspector` back and fires `onClose` exactly once.
      const handleInspectorSheetClose = useCallback(() => {
        sheetRef.current?.close()
      }, [])

      const handleSheetChange = useCallback(
        (index: number) => {
          if (index === -1) {
            setShowInspector(false)
            onClose?.()
          }
        },
        [onClose],
      )

      const renderSheetBackdrop = useCallback(
        (backdropProps: BottomSheetBackdropProps) => (
          <BottomSheetBackdrop {...backdropProps} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
        ),
        [],
      )

      // Syncs both directions, not just open: `hide()`/`hideInspector()` set
      // `showInspector` false directly, bypassing the sheet's own gesture
      // path, so the `else` branch is needed or the sheet stays visually open.
      // When the sheet itself triggered the close, `.close()` here is a
      // harmless no-op. The sheet stays mounted at all times in non-fullscreen
      // mode so gorhom's gesture/momentum machinery is always live.
      useEffect(() => {
        if (mode === 'fullscreen') return
        if (showInspector) {
          sheetRef.current?.snapToIndex(0)
        } else {
          sheetRef.current?.close()
        }
      }, [mode, showInspector])

      const {
        animatedStyle: bubblePositionStyle,
        gesture: bubbleGesture,
        setPosition: setBubblePosition,
      } = useBubbleDrag({
        initialPosition: initialBubblePosition,
        snapToEdge: true,
        bubbleWidth,
        bubbleHeight,
        safeAreaInsets,
        hideZoneHeight: 80,
        onDragStart: handleDragStart,
        onDragEnd: handleDragEnd,
        onHideZoneEnter: handleHideZoneEnter,
        onHideZoneExit: handleHideZoneExit,
        onHideZoneDrop: handleHideZoneDrop,
        onLongPress: handleBubbleLongPress,
        // Disable the bubble's own pan/long-press gestures while the sheet is
        // open, so a swipe meant for the sheet (their regions overlap at
        // large detent) is never also recognized as a bubble drag.
        enabled: !showInspector,
      })

      useImperativeHandle(
        ref,
        () => ({
          isVisible: () => showBubble || showInspector,
          show: () => {
            if (mode === 'bubble' && !showBubble) {
              setBubblePosition(initialBubblePosition)
              setShowBubble(true)
            } else {
              setShowInspector(true)
            }
          },
          hide: () => {
            setShowBubble(false)
            setShowInspector(false)
          },
          showInspector: () => setShowInspector(true),
          hideInspector: () => setShowInspector(false),
          getVisibility: () => ({
            bubbleVisible: showBubble,
            inspectorVisible: showInspector,
          }),
        }),
        [initialBubblePosition, mode, setBubblePosition, showBubble, showInspector],
      )

      const handleShake = useCallback(() => {
        if (!shakeEnabled) return

        if (mode === 'invisible' || mode === 'fullscreen') {
          setShowInspector((prev) => !prev)
        } else {
          if (!showBubble) {
            setBubblePosition(initialBubblePosition)
            setShowBubble(true)
          } else {
            setShowInspector((prev) => !prev)
          }
        }
      }, [initialBubblePosition, mode, setBubblePosition, shakeEnabled, showBubble])

      const { triggerShake } = useShakeDetection({
        onShake: handleShake,
        enabled: shakeEnabled,
        sensitivity: shakeSensitivity,
        minShakes,
        timeWindow: shakeTimeWindow,
      })

      // Fullscreen mode has no sheet to close, so it sets state directly;
      // non-fullscreen routes through the sheet's own close() so the exit
      // animation plays and `handleSheetChange` syncs state + fires onClose.
      const handleInspectorClose = useCallback(() => {
        if (mode === 'fullscreen') {
          setShowInspector(false)
          onClose?.()
        } else {
          handleInspectorSheetClose()
        }
      }, [handleInspectorSheetClose, mode, onClose])

      const handleClearLogs = useCallback(() => {
        Alert.alert('Clear All Logs', 'Are you sure you want to delete all network logs?', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              lightImpact()
              Hakka.clearLogs()
            },
          },
        ])
      }, [])

      // Console + Structured are LogsTabView's own internal segmented
      // sub-view — one page/one handler pair. Console capture is enabled
      // unconditionally on open since LogsTabView defaults to that section.
      const handleOpenAppLogsPage = useCallback(() => {
        ensureConsoleCapture()
        pages.openAppLogs()
      }, [pages])

      const filteredLogs = useMemo(() => {
        if (filterSnap.selectedDomains.size === 0) return logs
        return logs.filter((log) => filterSnap.selectedDomains.has(extractHost(log.url)))
      }, [logs, filterSnap.selectedDomains])

      const handleExport = useCallback(async () => {
        const logsToExport = filteredLogs.length > 0 ? filteredLogs : logs

        if (logsToExport.length === 0) {
          Alert.alert('No Data', 'There are no network logs to export.')
          return
        }

        if (onExport) {
          onExport()
          return
        }

        try {
          const harData = exportHarString(logsToExport)
          await Share.share({
            message: harData,
            title: `Network Logs (${logsToExport.length} requests).har`,
          })
        } catch {
          Alert.alert('Export Failed', 'Could not export network logs.')
        }
      }, [filteredLogs, logs, onExport])

      const { healthReport, jsRuntimeMetrics, handleLayoutMeasured } = useMonitorRuntimeMetrics(monitorActive)

      // Reports unfiltered totals; the floating bubble is the only place these numbers show.
      const globalMonitorSummary = useMemo(
        () =>
          createMonitorSummary({
            logs,
            totalCount,
            healthReport,
            jsRuntimeMetrics,
          }),
        [healthReport, jsRuntimeMetrics, logs, totalCount],
      )

      // Expose shake trigger for dev testing
      useEffect(() => {
        if (__DEV__ && shakeEnabled) {
          ;(globalThis as unknown as { __HAKKA_SHAKE__?: () => void }).__HAKKA_SHAKE__ = triggerShake
          return () => {
            delete (globalThis as unknown as { __HAKKA_SHAKE__?: () => void }).__HAKKA_SHAKE__
          }
        }
        return undefined
      }, [triggerShake, shakeEnabled])

      const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
      const hudModel = useMemo(() => createMonitorHudModel(globalMonitorSummary), [globalMonitorSummary])
      const bubbleHealthColor = useMemo(() => {
        if (hudModel.healthSeverity === 'good') return colors.success
        if (hudModel.healthSeverity === 'warning') return colors.warning
        return colors.error
      }, [colors.error, colors.success, colors.warning, hudModel.healthSeverity])

      if (!isReady) return null

      const barStyle = colors.background === darkColors.background ? 'light-content' : 'dark-content'

      const inspectorContent = (
        <InspectorContent
          barStyle={barStyle}
          colors={colors}
          styles={styles}
          mode={mode}
          logs={logs}
          globalMonitorSummary={globalMonitorSummary}
          healthReport={healthReport}
          page={pages.page}
          details={isDetailsOpen ? 'open' : 'closed'}
          header={{
            enabled: isReady,
            exportButton: showExportButton ? 'visible' : 'hidden',
            filteredCount: filterSnap.selectedDomains.size > 0 ? filteredLogs.length : undefined,
          }}
          filters={{
            query: filterSnap.filter,
            effectiveQuery: filterSnap.effectiveFilter,
            panel: filterSnap.showFilters ? 'expanded' : 'collapsed',
            statusGroup: filterSnap.statusGroup,
            methodFilters: filterSnap.methodFilters,
            sort: filterSnap.sortDesc ? 'newest' : 'oldest',
            bodySearch: filterSnap.searchInBody ? 'enabled' : 'disabled',
            nlSearch: filterSnap.nlMode ? 'enabled' : 'disabled',
            domains,
            selectedDomains: filterSnap.selectedDomains,
            groupBy: filterSnap.groupBy,
            sortBy: filterSnap.sortBy,
            sortDir: filterSnap.sortDir,
            savedFilters: filterSnap.savedFilters,
            recentFilters: filterSnap.recentFilters,
          }}
          isPaused={isPaused}
          onTogglePause={handleTogglePause}
          onOpenNetwork={pages.openNetwork}
          onCloseStats={pages.closeStats}
          onCloseRules={pages.closeRules}
          onCloseStorage={pages.closeStorage}
          onCloseAppLogs={pages.closeAppLogs}
          onCloseSettings={pages.closeSettings}
          onInspectorClose={handleInspectorClose}
          onExport={() => {
            void handleExport()
          }}
          onOpenStats={pages.openStats}
          onOpenRules={pages.openRules}
          onOpenStorage={pages.openStorage}
          onOpenAppLogs={handleOpenAppLogsPage}
          onOpenSettings={pages.openSettings}
          onClearLogs={handleClearLogs}
          onFilterChange={filtersVm.intents.setFilter}
          onToggleFilters={filtersVm.intents.toggleFilters}
          onStatusGroupChange={filtersVm.intents.setStatusGroup}
          onMethodToggle={filtersVm.intents.toggleMethod}
          onSortToggle={filtersVm.intents.toggleSortDesc}
          onSearchInBodyToggle={filtersVm.intents.setSearchInBody}
          onNlModeToggle={filtersVm.intents.setNlMode}
          onDomainToggle={filtersVm.intents.toggleDomain}
          onGroupByChange={filtersVm.intents.setGroupBy}
          onSortByChange={filtersVm.intents.setSortBy}
          onSortDirToggle={filtersVm.intents.toggleSortDir}
          onDetailsOpenChange={setIsDetailsOpen}
          onLayoutMeasured={handleLayoutMeasured}
          onSaveFilter={handleSaveFilter}
          onApplyFilter={filtersVm.intents.applyFilter}
          onRemoveSavedFilter={filtersVm.intents.removeSavedFilter}
          selectMode={selectionSnap.selectMode}
          onSelectModeToggle={selectionVm.intents.toggleSelectMode}
          selectedIds={selectionSnap.selectedIds}
          onToggleSelect={selectionVm.intents.toggleSelectId}
          onBulkExportHar={handleBulkExportHar}
          onBulkExportPostman={handleBulkExportPostman}
          onBulkExportOtel={handleBulkExportOtel}
          onCancelSelect={selectionVm.intents.clear}
        />
      )

      // `hudModel.statusText` already surfaces the network stat (e.g. "Errors
      // 6") when network is the headline severity — only append the raw stat
      // when it isn't already what statusText said, to avoid "Errors 6, Errors 6".
      const networkIsHeadline =
        globalMonitorSummary.networkSeverity === 'bad' || globalMonitorSummary.networkSeverity === 'warning'
      // "Network monitor", not "Open network monitor" — a tap expands the HUD
      // in place; opening the inspector is a long-press (see accessibilityHint below).
      const bubbleAccessibilityLabel =
        `Network monitor, ${globalMonitorSummary.totalRequests} captured requests, ` +
        `${hudModel.statusText}` +
        (networkIsHeadline
          ? ''
          : `, ${readableMonitorLabel(globalMonitorSummary.networkLabel)} ${globalMonitorSummary.networkValue}`) +
        `, UI ${hudModel.ui.value}, JS ${hudModel.js.value}`
      const bubbleAccessibilityHint =
        bubbleHudMode === 'collapsed'
          ? 'Shows recent requests. Long press to open the inspector.'
          : 'Collapses the monitor. Long press to open the inspector.'

      return (
        <>
          {mode === 'bubble' && showBubble && isDragging && showHideZone && (
            <View
              style={[
                styles.hideZone,
                {
                  bottom: safeAreaInsets.bottom + 16,
                  left: safeAreaInsets.left + 16,
                  right: safeAreaInsets.right + 16,
                },
              ]}
            >
              <Text style={[styles.hideZoneText, { color: colors.textMuted }]}>Drop here to hide</Text>
            </View>
          )}

          {mode === 'bubble' && showBubble && (
            <GestureDetector gesture={bubbleGesture}>
              <Reanimated.View style={[styles.container, bubblePositionStyle]}>
                <Reanimated.View style={scaleStyle}>
                  <FloatingMonitorHud
                    accessibilityHint={bubbleAccessibilityHint}
                    accessibilityLabel={bubbleAccessibilityLabel}
                    bubbleHeight={bubbleHeight}
                    bubbleWidth={bubbleWidth}
                    colors={colors}
                    healthColor={bubbleHealthColor}
                    mode={bubbleHudMode}
                    model={hudModel}
                    recentRequests={recentRequests}
                    styles={styles}
                    onOpenStats={pages.openStats}
                    onOpenSettings={pages.openSettings}
                    onToggleExpand={handleBubbleToggleExpand}
                    isCapturing={!isPaused}
                  />
                </Reanimated.View>
              </Reanimated.View>
            </GestureDetector>
          )}

          {mode === 'fullscreen' && showInspector && <View style={styles.fullscreenOverlay}>{inspectorContent}</View>}

          {mode !== 'fullscreen' && (
            <BottomSheet
              ref={sheetRef}
              index={-1}
              snapPoints={sheetSnapPoints}
              enableDynamicSizing={false}
              enablePanDownToClose
              android_keyboardInputMode="adjustResize"
              keyboardBehavior="interactive"
              keyboardBlurBehavior="restore"
              backdropComponent={renderSheetBackdrop}
              onChange={handleSheetChange}
              backgroundStyle={[
                styles.sheetBackground,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
              // No grabber: the sheet is already dismissible four other ways
              // (pan down, backdrop tap, header close, shake), and the tab
              // strip is a better first thing to land on than a decorative pill.
              handleComponent={null}
              style={styles.sheetShadow}
            >
              <View accessibilityLabel="Network monitor" testID="hakka-inspector-overlay" style={styles.fullContainer}>
                <SheetScrollableInjector>{inspectorContent}</SheetScrollableInjector>
              </View>
            </BottomSheet>
          )}
        </>
      )
    },
  )

  InspectorUI.displayName = 'HakkaInspectorUI'

  const NativeOverlayController = memo(
    ({
      mode = 'bubble',
      shake = DEFAULT_SHAKE_CONFIG,
      bubble = DEFAULT_BUBBLE_CONFIG,
    }: Pick<WrapperProps, 'mode' | 'shake' | 'bubble'>) => {
      const { isReady } = useHakka()
      const visibleRef = useRef(false)
      const initialVisible = mode === 'bubble' && (bubble?.showOnInit ?? false)
      const shakeEnabled = shake?.enabled ?? true
      const shakeSensitivity = shake?.sensitivity ?? 1.2
      const minShakes = shake?.minShakes ?? 1
      const shakeTimeWindow = shake?.timeWindow ?? 1000

      const showNative = useCallback((as: 'bubble' | 'sheet' | 'fullscreen' = 'bubble') => {
        Hakka.show({ as })
        visibleRef.current = true
      }, [])

      const hideNative = useCallback(() => {
        Hakka.hide()
        visibleRef.current = false
      }, [])

      const toggleNative = useCallback(() => {
        if (visibleRef.current) hideNative()
        else showNative(mode === 'fullscreen' ? 'fullscreen' : 'bubble')
      }, [hideNative, mode, showNative])

      useImperativeHandle(
        ref,
        () => ({
          isVisible: () => visibleRef.current,
          show: () => showNative(mode === 'fullscreen' ? 'fullscreen' : 'bubble'),
          hide: hideNative,
          showInspector: () => showNative('sheet'),
          hideInspector: hideNative,
          getVisibility: () => ({
            bubbleVisible: visibleRef.current && mode === 'bubble',
            inspectorVisible: visibleRef.current && mode !== 'bubble',
          }),
        }),
        [hideNative, mode, showNative],
      )

      useEffect(() => {
        if (!isReady) return undefined
        if (initialVisible) showNative('bubble')
        return hideNative
      }, [hideNative, initialVisible, isReady, showNative])

      useShakeDetection({
        onShake: toggleNative,
        enabled: shakeEnabled,
        sensitivity: shakeSensitivity,
        minShakes,
        timeWindow: shakeTimeWindow,
      })

      return null
    },
  )

  NativeOverlayController.displayName = 'HakkaInspector.NativeOverlayController'

  /** Wraps your entire app (recommended), similar to Redux Provider, NavigationContainer, etc. */
  export function Wrapper({ disabled = false, children, theme = 'dark', ...props }: WrapperProps): React.ReactElement {
    const scheme = useColorScheme()
    if (disabled) return children as React.ReactElement
    const resolvedTheme = theme === 'system' ? (scheme === 'light' ? 'light' : 'dark') : theme
    const useNativeOverlay = (props.mode ?? 'bubble') === 'bubble' && props.bubble?.renderMode === 'native'

    return (
      <GestureHandlerRootView style={WRAPPER_ROOT_STYLE}>
        {children}
        <ThemeProvider theme={resolvedTheme}>
          {useNativeOverlay ? (
            <NativeOverlayController {...props} />
          ) : (
            <CrashBoundary>
              <InspectorUI {...props} />
            </CrashBoundary>
          )}
        </ThemeProvider>
      </GestureHandlerRootView>
    )
  }

  Wrapper.displayName = 'HakkaInspector.Wrapper'

  /** Render anywhere the monitor should appear. Imperative show/hide only works with Wrapper. */
  export const Standalone: React.FC<
    Omit<WrapperProps, 'children' | 'disabled'> & { visible?: boolean; onClose?: () => void }
  > = ({ visible = true, theme = 'dark', onClose, ...props }) => {
    const scheme = useColorScheme()
    if (!visible) return null
    const resolvedTheme = theme === 'system' ? (scheme === 'light' ? 'light' : 'dark') : theme
    const useNativeOverlay = (props.mode ?? 'bubble') === 'bubble' && props.bubble?.renderMode === 'native'

    return (
      <GestureHandlerRootView style={WRAPPER_ROOT_STYLE}>
        <ThemeProvider theme={resolvedTheme}>
          {useNativeOverlay ? (
            <NativeOverlayController {...props} />
          ) : (
            <CrashBoundary>
              <InspectorUI {...props} onClose={onClose} />
            </CrashBoundary>
          )}
        </ThemeProvider>
      </GestureHandlerRootView>
    )
  }

  Standalone.displayName = 'HakkaInspector.Standalone'
}

export { HakkaInspector }
