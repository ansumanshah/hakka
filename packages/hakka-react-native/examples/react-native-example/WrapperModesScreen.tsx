/**
 * WrapperModesScreen — exercises `HakkaInspector.Wrapper`'s three display
 * modes: `'bubble'` (the default, used by the main app screen), `'invisible'`
 * (shake-only, no bubble), and `'fullscreen'` (the JS inspector fills the
 * screen on mount, no bubble to reopen it with).
 *
 * The mode picker below is a sibling BEFORE `<HakkaInspector.Wrapper>`, not
 * its `children` — so it can never be covered by whatever the Wrapper
 * renders. `HakkaInspector.Wrapper` puts `children` and its own overlay UI
 * side by side inside one `flex:1` root (see HakkaInspector.tsx — no Modal,
 * no portal), so an element outside the Wrapper entirely is safe regardless
 * of mode. Without this, switching to `'fullscreen'` would have no way back:
 * that mode has no bubble, and this bare example has no shake-to-open
 * fallback verified either (shake needs a physical device).
 */
import { HakkaInspector } from 'hakka-react-native/ui'
import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

type WrapperMode = 'bubble' | 'invisible' | 'fullscreen'

const MODES: ReadonlyArray<{ mode: WrapperMode; label: string; description: string }> = [
  {
    mode: 'bubble',
    label: 'Bubble',
    description: 'Draggable floating monitor. Tap to expand in place, long-press to open the sheet.',
  },
  {
    mode: 'invisible',
    label: 'Invisible',
    description: 'No bubble at all — shake the device to open the inspector. Needs a physical device.',
  },
  {
    mode: 'fullscreen',
    label: 'Fullscreen',
    description: 'The inspector fills the area below this header as soon as it mounts.',
  },
]

export interface WrapperModesScreenProps {
  onClose: () => void
}

export function WrapperModesScreen({ onClose }: WrapperModesScreenProps) {
  const [mode, setMode] = useState<WrapperMode>('bubble')
  const active = MODES.find((m) => m.mode === mode) ?? MODES[0]

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Inspector modes</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.modeRow}>
        {MODES.map((m) => {
          const selected = m.mode === mode
          return (
            <Pressable
              key={m.mode}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.modeButton, selected && styles.modeButtonSelected]}
              onPress={() => setMode(m.mode)}
            >
              <Text style={[styles.modeButtonText, selected && styles.modeButtonTextSelected]}>{m.label}</Text>
            </Pressable>
          )
        })}
      </View>

      <Text style={styles.description}>{active.description}</Text>

      {/* `key={mode}` forces a clean remount on mode change — InspectorUI seeds
          its bubble/fullscreen visibility from `mode` only on first mount, so
          reusing one instance across mode switches wouldn't reliably reset it. */}
      <HakkaInspector.Wrapper key={mode} mode={mode} bubble={{ showOnInit: true }}>
        <View style={styles.content} />
      </HakkaInspector.Wrapper>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080d13',
    paddingTop: 56,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  back: {
    color: '#6366f1',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 48,
  },
  title: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    minHeight: 34,
  },
  modeButtonSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  modeButtonText: {
    color: 'rgba(248,250,252,0.56)',
    fontSize: 13,
    fontWeight: '700',
  },
  modeButtonTextSelected: {
    color: '#ffffff',
  },
  description: {
    color: 'rgba(248,250,252,0.6)',
    fontSize: 13,
    fontWeight: '600',
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 4,
  },
  content: {
    flex: 1,
  },
})
