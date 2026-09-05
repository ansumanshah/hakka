import {
  Hakka,
  enableJsCapture,
  enableNativeCapture,
  mockEngine,
  ThrottleEngine,
  useNetworkLogs,
} from 'hakka-react-native'
import { useHakkaRozeniteDevTools } from 'hakka-rozenite'
import React, { useEffect, useState } from 'react'
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native'

import { WebViewCaptureScreen } from './WebViewCaptureScreen'

Hakka.start()
console.log('[RN Demo] Hakka active:', Hakka.isActive)

type ScenarioGroup = 'Traffic' | 'States' | 'Tools' | 'SDK'
type Tone = 'get' | 'post' | 'put' | 'delete' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const groups: ScenarioGroup[] = ['Traffic', 'States', 'Tools', 'SDK']

function fire(url: string, options?: RequestInit) {
  fetch(url, options).catch(() => {
    // Some demo buttons intentionally hit failing endpoints.
  })
}

async function showNativeOrWarn(as: 'bubble' | 'sheet' | 'fullscreen') {
  const handled = await Hakka.show({ as })
  if (!handled) {
    Alert.alert(
      'Native UI unavailable',
      'Start native capture and link the native inspector, then try again while the app is active.',
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
      testID={`demo-request-${label}`}
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
  useHakkaRozeniteDevTools()
  useEffect(() => {
    void Hakka.show({ as: 'bubble' })
    return () => Hakka.hide()
  }, [])
  const isDarkMode = useColorScheme() === 'dark'
  const [selectedGroup, setSelectedGroup] = useState<ScenarioGroup>('Traffic')
  const [showWebViewCapture, setShowWebViewCapture] = useState(false)
  const { logs, totalCount } = useNetworkLogs({ limit: 5 })
  const latestLog = logs.find((log) => !log.url.includes('localhost')) ?? logs[0]

  if (showWebViewCapture) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <StatusBar barStyle="light-content" />
        <WebViewCaptureScreen onClose={() => setShowWebViewCapture(false)} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
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
                  testID={`demo-group-${group}`}
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
          {selectedGroup === 'Tools' ? <ToolCommands onOpenWebViewCapture={() => setShowWebViewCapture(true)} /> : null}
          {selectedGroup === 'SDK' ? <SdkCommands /> : null}
        </ScrollView>
      </View>
    </SafeAreaView>
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
        <DemoButton
          label="Bubble"
          tone="info"
          onPress={() => {
            void showNativeOrWarn('bubble')
          }}
        />
        <DemoButton label="Hide inspector" tone="neutral" onPress={() => Hakka.hide()} />
        <DemoButton label="Sheet" tone="info" onPress={() => showNativeOrWarn('sheet')} />
        <DemoButton label="Fullscreen" tone="info" onPress={() => showNativeOrWarn('fullscreen')} />
      </Section>

      <Section title="WebView" subtitle="Capture traffic inside an embedded WebView">
        <DemoButton label="Open WebView capture" tone="neutral" onPress={onOpenWebViewCapture} />
      </Section>
    </>
  )
}

function SdkCommands() {
  // Local, not read from Hakka on every render — `Hakka.getConfig()`/`isActive`
  // aren't reactive, so this mirrors what the buttons below actually did rather
  // than polling. Seeded once from real state so the label is right on first
  // mount even if a previous screen already changed it.
  const [captureMode, setCaptureMode] = useState<string>(() => Hakka.getConfig().mode ?? 'auto')
  const [captureActive, setCaptureActive] = useState(() => Hakka.isActive)

  const setAutoCapture = () => {
    Hakka.stop()
    Hakka.start({ mode: 'auto' })
    setCaptureMode('auto')
    setCaptureActive(Hakka.isActive)
  }

  const setJsOnlyCapture = () => {
    enableJsCapture()
    setCaptureMode('js')
    setCaptureActive(Hakka.isActive)
  }

  // This example never links the native Hakka module (see README "What it
  // doesn't cover"), so `enableNativeCapture()` throws here — same real
  // failure `HakkaFacade.start({mode:'native'})` throws for any app that
  // hasn't linked it. It already called `Hakka.stop()` before throwing, so
  // capture would be left dark without the recovery restart below.
  const setNativeOnlyCapture = () => {
    try {
      enableNativeCapture()
      setCaptureMode('native')
    } catch (e: unknown) {
      Hakka.start({ mode: 'auto' })
      setCaptureMode('auto')
      const message = e instanceof Error ? e.message : String(e)
      Alert.alert(
        'Native module unavailable',
        `${message}\n\nThis example doesn't link the native Hakka module, so "native" mode has nothing to capture with. Capture mode was restored to "auto".`,
      )
    }
    setCaptureActive(Hakka.isActive)
  }

  const togglePause = () => {
    if (Hakka.isActive) {
      Hakka.stop()
    } else {
      Hakka.start()
    }
    setCaptureActive(Hakka.isActive)
  }

  const seedMockAndFire = () => {
    mockEngine.addRule({
      id: 'demo-mock-rule',
      pattern: 'httpbin.org/mock-demo',
      enabled: true,
      response: {
        status: 200,
        body: { mocked: true, source: 'react-native-example' },
      },
    })
    // Never reaches httpbin.org — the mock engine intercepts it first. Open
    // Rules > Mocks to see the rule; open the request in Network to see it
    // marked mocked.
    fire('https://httpbin.org/mock-demo')
  }

  const openWebSocket = () => {
    const socket = new WebSocket('wss://ws.postman-echo.com/raw')
    socket.onopen = () => socket.send('hello from react-native-example')
    socket.onmessage = () => socket.close()
    socket.onerror = () => {
      // Captured as a failed request either way — nothing else to do here.
    }
  }

  const fireGraphQL = () => {
    fire('https://countries.trevorblades.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query Countries { countries(filter: { code: { eq: "IN" } }) { code name } }',
      }),
    })
  }

  return (
    <>
      <Section title="Capture mode" subtitle={`Currently: ${captureMode}${captureActive ? '' : ' (paused)'}`}>
        <DemoButton label="Auto" tone="neutral" onPress={setAutoCapture} />
        <DemoButton label="JS only" tone="info" onPress={setJsOnlyCapture} />
        <DemoButton label="Native only" tone="danger" onPress={setNativeOnlyCapture} />
        <DemoButton label={captureActive ? 'Pause' : 'Resume'} tone="warning" onPress={togglePause} />
      </Section>

      <Section
        title="Rules"
        subtitle="Seed a mock rule and a throttle profile — breakpoints are configured live in the Rules tab"
      >
        <DemoButton label="Seed mock + fire" tone="info" onPress={seedMockAndFire} />
        <DemoButton label="Slow 3G" tone="warning" onPress={() => ThrottleEngine.setProfile('slow-3g')} />
        <DemoButton label="Reset speed" tone="neutral" onPress={() => ThrottleEngine.setProfile('none')} />
      </Section>

      <Section title="Protocols" subtitle="WebSocket frames and GraphQL operation detection">
        <DemoButton label="WS echo" tone="info" onPress={openWebSocket} />
        <DemoButton label="GraphQL query" tone="post" onPress={fireGraphQL} />
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
