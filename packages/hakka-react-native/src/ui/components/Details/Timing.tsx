import type { NetworkRequest } from 'hakka-core'
import React, { useMemo } from 'react'
import { Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { timing as timingColors } from '../../styles/tokens.generated'
import { formatDuration } from './helpers'

interface TimingProps {
  request: NetworkRequest
}

interface Phase {
  label: string
  ms: number
  color: string
}

/**
 * Per-request timing waterfall — parity with the iOS/Android native Timing tabs.
 * Phases come from request.timing; colors from the shared design tokens.
 */
export const Timing: React.FC<TimingProps> = ({ request }) => {
  const theme = useTheme()
  const styles = createStyles(theme)

  const phases = useMemo<Phase[]>(() => {
    const t = request.timing
    if (!t) return []
    const out: Phase[] = []
    // Canonical field names (dnsMs/connectMs/tlsMs/ttfbMs/downloadMs) — what
    // both capture paths actually populate. `native` mode (OkHttp/URLSession
    // event listeners) reports all five; `js` mode (fetch/XHR monkey-patch)
    // can only observe ttfbMs/downloadMs, leaving dns/connect/tls undefined,
    // so those three phases simply don't render for js-mode requests.
    if (t.dnsMs) out.push({ label: 'DNS Lookup', ms: t.dnsMs, color: timingColors.dns })
    if (t.connectMs) out.push({ label: 'TCP Handshake', ms: t.connectMs, color: timingColors.tcp })
    if (t.tlsMs) out.push({ label: 'TLS Handshake', ms: t.tlsMs, color: timingColors.tls })
    if (t.ttfbMs) out.push({ label: 'Waiting (TTFB)', ms: t.ttfbMs, color: timingColors.ttfb })
    if (t.downloadMs) out.push({ label: 'Content Download', ms: t.downloadMs, color: timingColors.download })
    return out
  }, [request.timing])

  const total = phases.reduce((sum, p) => sum + p.ms, 0)

  if (phases.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>No timing data captured for this request.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {phases.map((phase) => (
        <View key={phase.label} style={styles.row}>
          <Text style={styles.label} numberOfLines={1}>
            {phase.label}
          </Text>
          <View style={styles.track}>
            <View
              style={[
                styles.bar,
                { width: `${total > 0 ? Math.max(2, (phase.ms / total) * 100) : 0}%`, backgroundColor: phase.color },
              ]}
            />
          </View>
          <Text style={styles.value}>{formatDuration(phase.ms)}</Text>
        </View>
      ))}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatDuration(request.duration ?? total)}</Text>
      </View>
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  // Horizontal inset now comes from the pane (Details.tsx scrollContent) —
  // only vertical padding stays local, so the waterfall sits flush with the
  // headers/overview tables beside it.
  container: {
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  empty: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  label: {
    color: theme.colors.text,
    fontSize: theme.fontSize.sm,
    width: 120,
  },
  track: {
    flex: 1,
    height: 8, // ui-token-check-ignore: waterfall bar thickness
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.backgroundAlt,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: theme.radius.sm,
  },
  value: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.xs,
    width: 56,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  totalLabel: {
    color: theme.colors.text,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  totalValue: {
    color: theme.colors.text,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
}))
