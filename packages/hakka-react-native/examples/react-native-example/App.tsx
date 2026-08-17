import { Hakka, useNetworkLogs } from 'hakka-react-native'
import { HakkaInspector } from 'hakka-react-native/ui'
import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { WebViewCaptureScreen } from './WebViewCaptureScreen'

Hakka.start()
console.log('[RN Demo] Hakka active:', Hakka.isActive)

type ScenarioGroup = 'Traffic' | 'States' | 'Tools'
type Tone = 'get' | 'post' | 'put' | 'delete' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const groups: ScenarioGroup[] = ['Traffic', 'States', 'Tools']

function fire(url: string, options?: RequestInit) {
  fetch(url, options).catch(() => {
    // Some demo buttons intentionally hit failing endpoints.
  })
}

// This demo app doesn't link the optional native Hakka module, so
// Hakka.show({ as }) always falls back to a no-op here — `show()` returns
// `false` in that case (see HakkaFacade.show()). Without checking it, the
// "Sheet"/"Fullscreen" buttons silently did nothing, which reads as broken
// rather than "native module not linked."
function showNativeOrWarn(as: 'sheet' | 'fullscreen') {
  const handled = Hakka.show({ as })
  if (!handled) {
    Alert.alert(
      'Native UI unavailable',
      'The native Hakka module is not linked in this build, so showUI() has no effect. ' +
        'Install and link the hakka-react-native native modules to use this button.',
    )
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      <View style={styles.actions}>{children}</View>
    </View>
  )
}

function DemoButton({ label, tone, onPress }: { label: string; tone: Tone; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { borderColor: toneColors[tone] }, pressed && { opacity: 0.72 }]}
      onPress={onPress}
    >
      <View style={[styles.buttonAccent, { backgroundColor: toneColors[tone] }]} />
      <Text style={styles.buttonText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

function App() {
  const isDarkMode = useColorScheme() === 'dark'
  const [selectedGroup, setSelectedGroup] = useState<ScenarioGroup>('Traffic')
  const [showWebViewCapture, setShowWebViewCapture] = useState(false)
  const { logs, totalCount } = useNetworkLogs({ limit: 5 })
  const latestLog = logs.find((log) => !log.url.includes('localhost')) ?? logs[0]

  if (showWebViewCapture) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <WebViewCaptureScreen onClose={() => setShowWebViewCapture(false)} />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <HakkaInspector.Wrapper mode="bubble" bubble={{ showOnInit: true }}>
        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Text style={styles.heroIconText}>H</Text>
              </View>
              <View style={styles.heroText}>
                <Text style={styles.title}>Hakka RN</Text>
                <Text style={styles.subtitle}>Bare React Native capture demo</Text>
              </View>
            </View>

            <View style={styles.segmented}>
              {groups.map((group) => {
                const selected = selectedGroup === group
                return (
                  <Pressable
                    key={group}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.segment,
                      selected && styles.segmentSelected,
                      pressed && { opacity: 0.78 },
                    ]}
                    onPress={() => setSelectedGroup(group)}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{group}</Text>
                  </Pressable>
                )
              })}
            </View>

            <View accessibilityLabel={`Hakka captured ${totalCount} requests`} style={styles.runtimeStatus}>
              <Text style={styles.runtimeStatusTitle}>Captured {totalCount} requests</Text>
              <Text style={styles.runtimeStatusText} numberOfLines={1}>
                {latestLog ? `${latestLog.method} ${latestLog.url}` : 'Waiting for request'}
              </Text>
            </View>

            {selectedGroup === 'Traffic' ? <TrafficCommands /> : null}
            {selectedGroup === 'States' ? <StateCommands /> : null}
            {selectedGroup === 'Tools' ? (
              <ToolCommands onOpenWebViewCapture={() => setShowWebViewCapture(true)} />
            ) : null}
          </ScrollView>
        </View>
      </HakkaInspector.Wrapper>
    </SafeAreaProvider>
  )
}

function TrafficCommands() {
  return (
    <>
      <Section title="Methods" subtitle="Basic request methods">
        <DemoButton label="GET" tone="get" onPress={() => fire('https://httpbin.org/get')} />
        <DemoButton
          label="POST"
          tone="post"
          onPress={() =>
            fire('https://httpbin.org/post', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ source: 'react-native-example' }),
            })
          }
        />
        <DemoButton
          label="PUT"
          tone="put"
          onPress={() =>
            fire('https://httpbin.org/put', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ source: 'react-native-example' }),
            })
          }
        />
        <DemoButton
          label="DELETE"
          tone="delete"
          onPress={() => fire('https://httpbin.org/delete', { method: 'DELETE' })}
        />
      </Section>

      <Section title="Payloads" subtitle="Bodies, headers, and media">
        <DemoButton label="JSON" tone="info" onPress={() => fire('https://httpbin.org/json')} />
        <DemoButton
          label="Headers"
          tone="danger"
          onPress={() =>
            fire('https://httpbin.org/headers', {
              headers: {
                Authorization: 'Bearer demo-token',
                Cookie: 'session=demo',
              },
            })
          }
        />
        <DemoButton label="Large" tone="post" onPress={() => fire('https://httpbin.org/bytes/100000')} />
      </Section>
    </>
  )
}

function StateCommands() {
  return (
    <>
      <Section title="Status" subtitle="Success, client, and server responses">
        <DemoButton label="200" tone="success" onPress={() => fire('https://httpstat.us/200')} />
        <DemoButton label="404" tone="warning" onPress={() => fire('https://httpstat.us/404')} />
        <DemoButton label="500" tone="danger" onPress={() => fire('https://httpstat.us/500')} />
      </Section>

      <Section title="Timing" subtitle="Latency and redirects">
        <DemoButton label="Fast" tone="neutral" onPress={() => fire('https://httpbin.org/get')} />
        <DemoButton label="1s delay" tone="neutral" onPress={() => fire('https://httpbin.org/delay/1')} />
        <DemoButton label="Redirect" tone="warning" onPress={() => fire('https://httpbin.org/redirect/3')} />
      </Section>
    </>
  )
}

function ToolCommands({ onOpenWebViewCapture }: { onOpenWebViewCapture: () => void }) {
  return (
    <>
      <Section title="Edge cases" subtitle="Failures and unusual paths">
        <DemoButton label="DNS" tone="danger" onPress={() => fire('https://nonexistent.invalid/api')} />
        <DemoButton label="SSL" tone="danger" onPress={() => fire('https://expired.badssl.com/')} />
        <DemoButton label="Auth" tone="delete" onPress={() => fire('https://httpbin.org/bearer')} />
      </Section>

      <Section title="Native UI" subtitle="Platform-native inspector via Hakka.show()">
        <DemoButton label="Sheet" tone="info" onPress={() => showNativeOrWarn('sheet')} />
        <DemoButton label="Fullscreen" tone="info" onPress={() => showNativeOrWarn('fullscreen')} />
      </Section>

      <Section title="WebView" subtitle="Capture traffic inside an embedded WebView">
        <DemoButton label="Open WebView capture" tone="neutral" onPress={onOpenWebViewCapture} />
      </Section>
    </>
  )
}

const toneColors: Record<Tone, string> = {
  get: '#d97706',
  post: '#3b82f6',
  put: '#8b5cf6',
  delete: '#ef4444',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#6366f1',
  neutral: '#34d399',
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080d13',
  },
  content: {
    padding: 20,
    // Clear the floating Hakka bubble (shown on init) so it doesn't cover the hero.
    paddingTop: 84,
    paddingBottom: 120,
    gap: 16,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  heroIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: 'rgba(59,130,246,0.28)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroIconText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  heroText: {
    flex: 1,
  },
  title: {
    color: '#f8fafc',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: 'rgba(248,250,252,0.64)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
  segmented: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    minHeight: 34,
  },
  segmentSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  segmentText: {
    color: 'rgba(248,250,252,0.56)',
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextSelected: {
    color: '#ffffff',
  },
  runtimeStatus: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  runtimeStatusTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  runtimeStatusText: {
    color: 'rgba(248,250,252,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: 'rgba(248,250,252,0.55)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    minWidth: 138,
    paddingHorizontal: 12,
  },
  buttonAccent: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  buttonText: {
    color: '#ffffff',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
})

export default App
