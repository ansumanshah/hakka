---
title: Storage panel
description: Spec card — the in-app key/value storage viewer (web localStorage/sessionStorage/cookies, RN AsyncStorage/MMKV, iOS UserDefaults, Android SharedPreferences).
---

## What it does

The storage panel lets a developer view, search, and delete the app's own local key/value data
from inside the inspector — the platform-native store (`UserDefaults`, `SharedPreferences`,
`localStorage`/`sessionStorage`/cookies, `AsyncStorage`/MMKV), not `hakka-core`'s own capture
ring buffer. RN additionally supports in-place editing of entries.

## Public API

Web (`packages/hakka-browser/src/adapters/storage.ts` — internal to the overlay's Storage
panel today; not exported from `hakka-browser`'s public surface. A public subpath
export is queued for 0.2.0):

```ts
// internal module signatures (not yet importable by consumers)

readStorage() // { local: KV[], session: KV[], cookies: KV[] } — excludes 'hakka:'-prefixed keys
setStorageItem('local' | 'session', key, value)
setCookie(key, value, { path?, expires? }) // no HttpOnly — JS-settable surface only
removeStorageItem(area: 'local' | 'session' | 'cookies', key)
clearStorageArea(area)
```

RN (`hakka-react-native`) monitoring hooks forward every read/write/delete to the desktop
companion; the in-app `StorageViewer` screen additionally supports direct edit/delete:

```ts
import { useAsyncStorageMonitor, useMMKVMonitor } from 'hakka-react-native/monitors'

useAsyncStorageMonitor() // no-ops if @react-native-async-storage/async-storage isn't installed
useMMKVMonitor(mmkvInstance) // no-ops if no instance is passed
```

iOS: `StorageView` (SwiftUI) reads/writes `UserDefaults.standard` directly, refreshing on a 1s
timer. Android: the Storage tab (`StorageTabController`, one of the five persistent
bottom-nav tabs) scans the app's `shared_prefs` directory and lists every
`SharedPreferences` file's key/value pairs.

## Config keys + defaults

None — the storage panel is a UI feature with no `HakkaConfig` keys. Web's adapter has one fixed
convention: keys prefixed `hakka:` are treated as internal state and excluded from every
read/write/clear operation.

## Platform matrix

SPEC §5 row "Storage panel":

| Capability    | RN  | iOS | Android | Web | Mac app |
| ------------- | --- | --- | ------- | --- | ------- |
| Storage panel | ●   | ●   | ●       | ●   | —       |

Per SPEC §2 (panel set): web covers localStorage/sessionStorage/cookies; RN covers
AsyncStorage/MMKV (view + delete, **in-place edit** only on RN); iOS covers `UserDefaults`;
Android covers `SharedPreferences`.

## Wire format

RN's monitor hooks emit a `StorageData` event over the internal bridge event bus (not the
desktop bridge protocol):

```ts
interface StorageData {
  storageType: 'AsyncStorage' | 'MMKV' | 'Zustand' | 'Redux' | 'Context'
  key: string
  value: unknown
  operation: 'get' | 'set' | 'remove' | 'clear'
  timestamp: number
}
```

## Test anchors

- `packages/hakka-browser/src/ui/StorageTab.test.tsx`
- `ios/Tests/HakkaTests/StorageAdapterTests.swift`
- `android/hakka-network/src/test/kotlin/com/noodleapps/hakka/StorageAdapterTest.kt`

## Limits & non-goals

- No dangerous permissions on Android — `SharedPreferences` files live in the app's own sandbox,
  so the panel only ever reads its own app's data.
- iOS's `StorageView` covers `UserDefaults` only — Keychain and file-based storage are out of
  scope.
- Web's cookie writer cannot set or read `HttpOnly` cookies — that flag is server-only by design;
  every entry the panel shows is, by construction, one JS already fully controls.
- RN's `StorageType` union includes `'Zustand' | 'Redux' | 'Context'` as forward-declared
  categories in the type, but the shipped monitor hooks only patch AsyncStorage and MMKV today.
