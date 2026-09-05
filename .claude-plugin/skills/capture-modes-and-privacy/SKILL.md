# hakka-capture-modes-and-privacy

Choose the right Hakka capture mode for your stack and configure privacy filters to redact sensitive headers, hosts, and URL patterns.

## Steps

1. React Native uses native capture only. `Hakka.start()` defaults to native and throws if the native module is missing. Rebuild the app with Hakka linked; there is no JavaScript fallback. The shared core's other modes serve browser/server integrations.

2. Start and stop capture:

   ```ts
   import { Hakka } from 'hakka-react-native'

   Hakka.start()
   Hakka.stop()
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
