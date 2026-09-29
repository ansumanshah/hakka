---
title: Native Capture
description: Native-only capture, startup requirements, and platform coverage in React Native.
---

React Native uses native capture exclusively. It is the default, so omit `mode`:

```ts
import { Hakka } from 'hakka-react-native'

Hakka.start()
```

`Hakka.start({ mode: 'native' })` is equivalent. Other capture modes are not
supported by `hakka-react-native`. Browser and server packages retain their own
capture APIs.

## Native module required

Startup throws when Hakka's TurboModule is missing. Install native dependencies
and rebuild the app. Expo requires a development build; Expo Go is unsupported.
There is no automatic JavaScript fallback.

HTTP capture observes requests made through the configured native OkHttp and
URLSession integration, including React Native fetch/XHR traffic using those paths.

## Automatic interception

Call `Hakka.start()` before making requests. You do not need to replace `fetch`,
XHR, or Axios calls that use React Native's networking stack.

- **Android:** the autolinked Hakka package registers its OkHttp client factory
  before React Native creates its networking modules. No `MainApplication` patch
  is needed for the default RN client. Hakka copies the client returned by the
  current RN factory, retaining its interceptors, TLS configuration, certificate
  pinning, cookies, and timeouts. The automatic path snapshots one client; it
  cannot retain factory behavior that creates a different client each time. A
  factory installed afterward replaces Hakka's integration. Separate OkHttp
  clients, Cronet, and other native networking stacks are not intercepted globally.
- **iOS:** Hakka registers a `URLProtocol` and hooks default/ephemeral
  `URLSessionConfiguration` creation when capture starts. Requests using sessions
  created through those paths after startup are automatic. Existing sessions are
  not retrofitted; background sessions and networking outside `URLSession` are
  not covered.

### Android host-owned networking

Configure a custom factory **before** autolinked packages and RN networking
modules are created (for example, before `PackageList(this).packages`):

```kotlin
import com.facebook.react.modules.network.OkHttpClientFactory
import com.noodleapps.hakka.rn.HakkaOkHttpClientFactory
import okhttp3.OkHttpClient

HakkaOkHttpClientFactory.configure(object : OkHttpClientFactory {
    override fun createNewNetworkModuleClient(): OkHttpClient =
        myClient
})
```

`configure` wraps every host factory result. Alternatively, call
`HakkaOkHttpClientFactory.disableAutomaticInstallation()` before package
construction and have your factory return
`HakkaOkHttpClientFactory.withCapture(myClient)`. `withCapture` adds the stable
Hakka interceptor once and preserves the client's configuration. Opting out
without adding capture leaves host networking unobserved. Already-created
networking modules and RN's cached WebSocket client cannot be retrofitted;
restart/recreate them after changing factories. Automatic HTTP capture does not
provide WebSocket frame capture.

WebView traffic has a separate [integration](/guides/react-native-webview/).
Automatic HTTP capture does not imply automatic WebSocket frame capture.

## Stop capture

Use `Hakka.stop()` or `Hakka.configure({ enabled: false })`. To re-enable capture,
call `Hakka.start({ enabled: true })`.

## WebSockets

Native HTTP interception does not capture JavaScript WebSocket frame payloads.
Native WebSocket monitoring is available through the platform SDK's explicit
instrumentation; its metadata and payload coverage depend on that integration.

## Mock rules

Rules configured through `mockEngine` are mirrored to the native SDK where supported.
