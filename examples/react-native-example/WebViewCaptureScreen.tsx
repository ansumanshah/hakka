/**
 * WebViewCaptureScreen — F5 recipe: capture traffic that happens *inside* an
 * embedded `react-native-webview`, bridged to the same Hakka desktop hub the
 * RN app itself talks to, so no RN network tool's WebView blind spot applies.
 *
 * See docs/src/content/docs/guides/react-native-webview.md for the full
 * start-to-finish writeup (unified timeline, ATS/CSP caveats). This screen is
 * the runnable half of that guide.
 *
 * Prerequisite: `bun run copy:hakka-browser` (see package.json + scripts/copy-hakka-browser.js)
 * must have been run at least once — it copies packages/hakka-browser/dist/hakka-browser.global.js
 * into ./assets/ (gitignored, regenerate after every hakka-browser build). Without it, the import
 * below resolves to a stub written by scripts/ensure-webview-asset.js (a `preios`/`preandroid`/
 * `prestart` hook — see package.json) instead of the real bundle, which is what keeps Metro able
 * to bundle this app on a fresh clone. `hakkaWebBundle.placeholder` below is how this screen tells
 * the two apart.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'

// The built hakka-browser IIFE (assigns `window.Hakka` when evaluated), wrapped as
// `{ code: string }` so Metro/TS import it as data (resolveJsonModule) instead
// of trying to bundle-and-run it — the raw file is a browser-only IIFE that
// touches `window`/`document` at module scope, which would throw immediately
// if Metro ever executed it inside the RN JS engine (Hermes) instead of a
// WebView's DOM. See scripts/copy-hakka-browser.js for how this file is produced.
import hakkaWebBundleJson from './assets/hakka-browser.global.json'

// The real file (copy-hakka-browser.js) only ever has `code`; `placeholder` only
// appears on the stub scripts/ensure-webview-asset.js writes when the real one
// is missing. Widening the JSON-inferred type here (instead of just accessing
// `.placeholder` on it directly) keeps this working whichever variant Metro
// happens to have bundled, since TS otherwise infers the exact on-disk shape.
const hakkaWebBundle = hakkaWebBundleJson as { code: string; placeholder?: boolean }

const BRIDGE_PORT = 8989

/**
 * Bridge host per RN runtime — `hakka-bridge` binds `127.0.0.1` (loopback)
 * only by default (see packages/hakka-bridge/src/server.ts, BridgeServerOptions.host):
 *
 *  - iOS Simulator shares the host Mac's loopback interface, so `localhost`
 *    reaches the hub directly. No extra config needed.
 *  - Android Emulator aliases `10.0.2.2` to the host machine's loopback, which
 *    ALSO reaches a 127.0.0.1-bound hub (this is standard Android-emulator
 *    networking, not Hakka-specific). `adb reverse tcp:8989 tcp:8989` +
 *    `localhost` works too, for an emulator or a USB-connected device.
 *  - A physical device over Wi-Fi cannot reach a loopback-only hub at all.
 *    Start the hub yourself with `startBridgeServer({ host: '0.0.0.0' })`
 *    (the `npx hakka-bridge` CLI has no `--host` flag — loopback-only is
 *    hardcoded there) and replace this with your machine's LAN IP
 *    (`ipconfig getifaddr en0` on macOS). Only do this on a network you
 *    trust — once opened up, anyone who can reach the port can read every
 *    captured request/response body.
 *
 * This example's native shells already carry the local-networking exceptions
 * this needs: iOS `Info.plist` sets `NSAllowsLocalNetworking: true`, and the
 * Android debug manifest sets `usesCleartextTraffic="true"` — both required
 * for a plain `ws://` (non-TLS) connection to a loopback/LAN host under
 * default ATS / Network Security Config policy. A physical iOS device may
 * also prompt for the iOS 14+ "Local Network" permission the first time it
 * dials a LAN address — see the docs guide's caveats table.
 */
const DEFAULT_BRIDGE_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost'

/**
 * Builds the local WebView page: the hakka-browser IIFE, then a small script that
 * starts capture, connects to the bridge, fires 3 sample fetches, and posts
 * the falsifiable result back to RN via `window.ReactNativeWebView.postMessage`.
 */
function buildPageHtml(bridgeHost: string): string {
  const bridgeUrl = `ws://${bridgeHost}:${BRIDGE_PORT}`
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script>${hakkaWebBundle.code}</script>
    <script>
      (function () {
        // Independent probe — NOT a read of hakka-browser's internal
        // StoreClient.usingWorker (that field is private to packages/hakka-browser/src;
        // this recipe doesn't patch SDK source to expose it — see the repo's
        // guide for why). It mirrors the exact condition hakka-browser's own
        // createStoreClient() uses internally (Worker global present, and a
        // blob-URL Worker actually constructs without throwing — the same
        // failure mode a restrictive worker-src CSP would trigger), so it is
        // an honest proxy for "which backend hakka-browser is running on," not a
        // claim of reading the private flag directly.
        function probeWorkerSupport() {
          if (typeof Worker === 'undefined') return false
          try {
            var blob = new Blob(['self.close()'], { type: 'application/javascript' })
            var url = URL.createObjectURL(blob)
            var worker = new Worker(url)
            worker.terminate()
            URL.revokeObjectURL(url)
            return true
          } catch (e) {
            return false
          }
        }

        function postToRN(payload) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload))
          }
        }

        Hakka.start({ overlay: false })
        Hakka.connect(${JSON.stringify(bridgeUrl)})

        // 3 sample fetches — same demo host the RN screen (App.tsx) uses, so
        // the desktop hub's unified timeline shows WebView + RN traffic on
        // the same familiar endpoints.
        var fetches = [
          fetch('https://httpbin.org/get'),
          fetch('https://httpbin.org/post', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: 'webview-capture-screen' }),
          }),
          fetch('https://httpbin.org/status/404'),
        ]

        Promise.allSettled(fetches)
          .then(function () {
            return Hakka.getLogs()
          })
          .then(function (logs) {
            postToRN({ usingWorker: probeWorkerSupport(), captureCount: logs.length })
          })
          .catch(function (err) {
            postToRN({ error: String((err && err.message) || err) })
          })
      })()
    </script>
  </body>
</html>`
}

interface CaptureResult {
  usingWorker: boolean
  captureCount: number
}

export interface WebViewCaptureScreenProps {
  onClose: () => void
}

export function WebViewCaptureScreen({ onClose }: WebViewCaptureScreenProps) {
  if (hakkaWebBundle.placeholder) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>WebView capture</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.placeholderBox}>
          <Text style={styles.placeholderText}>
            hakka-browser hasn't been built yet, so this screen has nothing real to inject into the WebView. From the
            repo root, run:
          </Text>
          <Text style={styles.placeholderCode}>
            bun run --cwd packages/hakka-browser build{'\n'}bun run copy:hakka-browser
          </Text>
          <Text style={styles.placeholderText}>then reload the app.</Text>
        </View>
      </View>
    )
  }

  return <WebViewCaptureScreenReady onClose={onClose} />
}

function WebViewCaptureScreenReady({ onClose }: WebViewCaptureScreenProps) {
  // `bridgeHost` is the *committed* value the WebView page is built from —
  // it only changes when Reload is pressed. `bridgeHostDraft` is the live
  // TextInput value. Keeping them separate means typing a new host doesn't
  // rebuild `html` (and therefore doesn't reload the WebView) on every
  // keystroke — only an explicit Reload commits the draft and reloads.
  const [bridgeHost, setBridgeHost] = useState(DEFAULT_BRIDGE_HOST)
  const [bridgeHostDraft, setBridgeHostDraft] = useState(DEFAULT_BRIDGE_HOST)
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // `baseUrl` gives the page a real `http://localhost` origin (instead of the
  // opaque `null` origin a bare `source.html` load otherwise gets). That
  // matters here: the bridge hub only accepts WebSocket `Origin` headers of
  // `localhost`/`127.0.0.1`/`[::1]` (or an explicit allowlist) — see
  // `isOriginAllowed` in packages/hakka-bridge/src/server.ts. An opaque/`"null"`
  // origin would fail that check and the WS handshake would be rejected
  // (code 1008). No network request is made to this URL; it only sets the
  // document's origin for same-page fetch/WS resolution.
  const html = useMemo(() => buildPageHtml(bridgeHost), [bridgeHost, reloadKey])

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data: unknown = JSON.parse(event.nativeEvent.data)
      if (
        data &&
        typeof data === 'object' &&
        'usingWorker' in data &&
        'captureCount' in data &&
        typeof (data as CaptureResult).usingWorker === 'boolean' &&
        typeof (data as CaptureResult).captureCount === 'number'
      ) {
        setError(null)
        setResult(data as CaptureResult)
      } else if (data && typeof data === 'object' && 'error' in data) {
        setError(String((data as { error: unknown }).error))
      }
    } catch {
      // Malformed/foreign postMessage payload — ignore rather than throw.
    }
  }, [])

  const reload = useCallback(() => {
    setResult(null)
    setError(null)
    setBridgeHost(bridgeHostDraft)
    setReloadKey((key) => key + 1)
  }, [bridgeHostDraft])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>WebView capture</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.hostRow}>
        <Text style={styles.hostLabel}>Bridge host</Text>
        <TextInput
          style={styles.hostInput}
          value={bridgeHostDraft}
          onChangeText={setBridgeHostDraft}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder="localhost / 10.0.2.2 / 192.168.x.x"
          placeholderTextColor="rgba(248,250,252,0.4)"
        />
        <Pressable accessibilityRole="button" style={styles.reloadButton} onPress={reload}>
          <Text style={styles.reloadText}>Reload</Text>
        </Pressable>
      </View>

      <View
        style={styles.resultBox}
        accessibilityLabel={
          result
            ? `usingWorker ${String(result.usingWorker)}, captured ${result.captureCount} requests`
            : 'Waiting for the WebView page to report in'
        }
      >
        <Text style={styles.resultText}>
          {error
            ? `WebView page error: ${error}`
            : result
              ? `usingWorker: ${String(result.usingWorker)}   |   captured: ${result.captureCount}`
              : 'Waiting for the WebView page to report in…'}
        </Text>
      </View>

      <WebView
        key={reloadKey}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'http://localhost/' }}
        onMessage={onMessage}
        style={styles.webview}
      />
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
  hostRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  hostLabel: {
    color: 'rgba(248,250,252,0.6)',
    fontSize: 12,
    fontWeight: '700',
  },
  hostInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    color: '#f8fafc',
    flex: 1,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reloadButton: {
    backgroundColor: 'rgba(99,102,241,0.24)',
    borderColor: 'rgba(99,102,241,0.5)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  reloadText: {
    color: '#c7d2fe',
    fontSize: 13,
    fontWeight: '700',
  },
  resultBox: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resultText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  placeholderBox: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    marginHorizontal: 20,
    marginTop: 8,
    padding: 18,
  },
  placeholderText: {
    color: 'rgba(248,250,252,0.72)',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  placeholderCode: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
    color: '#c7d2fe',
    fontFamily: 'Menlo',
    fontSize: 12,
    padding: 10,
  },
  webview: {
    flex: 1,
  },
})
