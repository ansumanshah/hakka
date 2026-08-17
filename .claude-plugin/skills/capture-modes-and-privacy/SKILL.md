# hakka-capture-modes-and-privacy

Choose the right Hakka capture mode for your stack and configure privacy filters to redact sensitive headers, hosts, and URL patterns.

## Steps

1. **Choose capture mode** when calling `Hakka.start({ mode: '...' })`:

   | Mode         | How it works                                                                                                                | Use when                                                         |
   | ------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
   | `'native'`   | OkHttp interceptor (Android) / URLProtocol (iOS). Sees SDK-level traffic. Fails fast if native module unavailable.          | Bare RN with native linking                                      |
   | `'js'`       | Patches `fetch`, `XMLHttpRequest`, `WebSocket` in the JS runtime. Does NOT see native-layer traffic (e.g. image downloads). | Native module unavailable, or Expo Go (not officially supported) |
   | `'auto'`     | Tries native first, falls back to JS.                                                                                       | Recommended default                                              |
   | `'disabled'` | Capture off entirely.                                                                                                       | Production / opt-out flows                                       |

2. Switch modes at runtime:

   ```ts
   import { enableNativeCapture, enableJsCapture } from 'hakka-react-native'

   enableNativeCapture() // switch to native interceptor
   enableJsCapture() // switch to JS-layer patching
   ```

3. **Request limits** (configure in `Hakka.start()` or `Hakka.configure()`):

   ```ts
   Hakka.configure({
     maxRequests: 500, // ring buffer size — oldest dropped when full (default: 100)
     maxBodySize: 524288, // body truncation in bytes — 512 KB (default: 262144)
   })
   ```

4. **Header redaction** (all platforms, case-insensitive):

   ```ts
   Hakka.start({
     mode: 'auto',
     redactHeaders: ['authorization', 'cookie', 'set-cookie', 'x-api-key'],
   })
   ```

   The default set already redacts `authorization`, `proxy-authorization`, `cookie`, and `set-cookie`. Extend it — do not replace the defaults unless intentional.

5. **Host and pattern filtering** — suppress requests from the inspector entirely:

   ```ts
   Hakka.start({
     ignoreHosts: ['analytics.example.com', 'metrics.internal'],
     ignorePatterns: [/\/healthz$/, /\/metrics$/],
   })
   ```

6. **iOS-only privacy fields** (not available from the React Native `Hakka.start()` config — set these directly on the Swift interceptor):

   ```swift
   HakkaInterceptor.shared.start(config: HakkaConfig(
     sensitiveQueryItems: ["token", "api_key"],  // redacts query param values
     sensitiveBodyFields: ["password", "card"]   // redacts JSON body field values
   ))
   ```

   Android v0.1.0 does not expose `sensitiveQueryItems` or `sensitiveBodyFields`. Use `redactHeaders` and `ignorePatterns` for Android privacy filtering.

7. **Request persistence** across app restarts:
   ```ts
   Hakka.start({
     persist: true,
     maxAge: 86400, // seconds — 24 hours
   })
   ```
   Disabled by default. Storage uses MMKV if available, falls back to AsyncStorage.
