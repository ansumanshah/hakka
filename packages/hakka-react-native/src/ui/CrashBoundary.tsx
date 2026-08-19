/**
 * Root-level crash containment for the JS inspector overlay.
 *
 * A guest overlay must never take down the host app — an uncaught error
 * thrown while rendering (or updating) any inspector panel has to stay
 * inside the inspector's own subtree instead of propagating up into the
 * host's component tree. React only offers error boundaries as class
 * components (there is no hooks-based equivalent), so this stays a class
 * even though the rest of `src/ui` is functional.
 *
 * Mirrors `hakka-browser/src/ui/CrashBoundary.tsx`'s `<Errored>` contract: a
 * crashed inspector renders a compact "Inspector crashed — Reload" bar
 * instead of freezing or taking down the host screen, and Reload does a
 * real teardown + remount, not a local retry that re-renders in place and
 * inherits whatever corrupted the previous tree.
 *
 * `HakkaInspector.tsx`'s `Wrapper` and `Standalone` are the only two places
 * that render the JS inspector tree as the root of the overlay — both wrap
 * `InspectorUI` in `CrashBoundary` so the guard lives in one place.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { Button } from './components/primitives'
import { createStyleSheet, useTheme } from './styles'

export interface CrashBoundaryProps {
  children: React.ReactNode
}

interface CrashBoundaryState {
  error: Error | null
  generation: number
}

function CrashFallback({ onReload }: { onReload: () => void }): React.ReactElement {
  const theme = useTheme()
  const { colors } = theme
  const styles = createStyles(theme)

  return (
    <View
      testID="hakka-crash-bar"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.bar, { backgroundColor: colors.backgroundAlt, borderBottomColor: colors.chili }]}
    >
      <Text style={[styles.text, { color: colors.chili }]}>Inspector crashed — reload</Text>
      <Button label="Reload" tone="danger" testID="hakka-crash-reload" onPress={onReload} />
    </View>
  )
}

/**
 * Catches anything thrown while rendering or updating the guarded subtree
 * and swaps in `CrashFallback`. Reload bumps `generation`, which is used as
 * the `key` on the wrapped children below — a `key` change at the same tree
 * position makes React discard the old subtree (and whatever corrupted
 * state caused the crash) and mount a brand new one, unlike
 * `getDerivedStateFromError`'s own reset, which would re-render the same
 * subtree in place and could inherit the same corruption.
 *
 * Captured traffic survives a crash + reload: `Hakka`'s log storage
 * (`hakka-core`'s `HakkaFacade`) is a module-level singleton that lives
 * outside this component tree, so unmounting/remounting the inspector's
 * React tree never touches it — `HakkaFacade.stop()` (called by
 * `useHakka`'s unmount cleanup) tears capture down without ever calling
 * `clearLogs()`.
 */
export class CrashBoundary extends React.Component<CrashBoundaryProps, CrashBoundaryState> {
  state: CrashBoundaryState = { error: null, generation: 0 }

  static getDerivedStateFromError(error: Error): Pick<CrashBoundaryState, 'error'> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The only trace of a contained crash — nothing else surfaces it.
    console.error('[hakka] inspector crashed and was contained by the root boundary', error, info.componentStack)
  }

  private handleReload = (): void => {
    this.setState((prev) => ({ error: null, generation: prev.generation + 1 }))
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return <CrashFallback onReload={this.handleReload} />
    }
    // The key change on reload is what forces the real unmount + remount —
    // see the class doc comment above.
    return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>
  }
}

const createStyles = createStyleSheet((theme) => ({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: theme.spacing.md,
    paddingHorizontal: theme.layout.gutter,
    paddingTop: theme.spacing.xxl,
    paddingBottom: theme.spacing.md,
    minHeight: theme.controlHeight.bar,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
}))
