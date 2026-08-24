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
timer, and now also publishes each refresh as a `storage` bridge frame
(`HakkaInterceptor.publishStorageSnapshot(store:entries:)` →
`HakkaBridgeClient.sendStorage`) so the Mac app's own Storage panel mirrors it live. Android: the
Storage tab (`StorageTabController`, one of the five persistent bottom-nav tabs) scans the app's
`shared_prefs` directory and lists every `SharedPreferences` file's key/value pairs.

Mac app (`apps/hakka`): `StoragePanelView` (reached from the sidebar's Traffic section) renders
every named `StorageSnapshot` a connected device has published — one disclosure section per
store (e.g. `"defaults"`), key/value entries beneath. A store picker (`StorageFilterBar`, shown
once more than one store has reported in) scopes the list to one store at a time, and a key/value
search (`StorageModel.visibleStores`) narrows entries within it; each snapshot's disclosure header
shows its age as a relative timestamp that flags itself stale past 30s with no new snapshot.
Copying a key or value is a `.contextMenu` action on the row. Snapshot-replace only: a later
snapshot for the same store name fully replaces the last one, there is no history or diff. Today
only the iOS SDK actually sends `storage` frames; RN and Android accept the wire shape (unknown
frame kinds are already ignored gracefully by both) but do not yet publish snapshots.

## Config keys + defaults

None — the storage panel is a UI feature with no `HakkaConfig` keys. Web's adapter has one fixed
convention: keys prefixed `hakka:` are treated as internal state and excluded from every
read/write/clear operation.

## Platform matrix

SPEC §5 row "Storage panel":

| Capability    | RN  | iOS | Android | Web | Mac app |
| ------------- | --- | --- | ------- | --- | ------- |
| Storage panel | ●   | ●   | ●       | ●   | ●       |

Per SPEC §2 (panel set): web covers localStorage/sessionStorage/cookies; RN covers
AsyncStorage/MMKV (view + delete, **in-place edit** only on RN); iOS covers `UserDefaults`;
Android covers `SharedPreferences`.

## Wire format

The desktop bridge protocol (`packages/hakka-bridge/src/protocol.ts`) carries a `storage` frame,
mirrored in Swift by `apps/hakka/Sources/Server/BridgeWireFrame.swift`:

```ts
interface BridgeStorageMessage {
  type: 'storage'
  payload: StorageSnapshot // { store: string; timestamp: number; entries: Record<string, string> }
}
```

`store` is a free-form name the sender picks (`"defaults"`, `"keychain-redacted"`, `"cookies"`,
...); `entries` is always already redacted by the sender before it is sent. A later frame for the
same `store` fully replaces the prior one on the receiving hub/panel — this is not a diff.
Fixtures: `fixtures/storage/`.

RN's monitor hooks separately emit a `StorageData` event over the internal bridge event bus (not
the desktop bridge protocol) — see below. That event and the `storage` bridge frame are unrelated
wire shapes serving different consumers.

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

- `packages/hakka-browser/src/ui/__tests__/StorageTab.test.tsx`
- `ios/Tests/HakkaTests/StorageAdapterTests.swift`
- `android/hakka-network/src/test/kotlin/com/noodleapps/hakka/StorageAdapterTest.kt`
- `packages/hakka-bridge/src/__tests__/BridgeHub.test.ts`, `server.test.ts` — `storage` frame parse/relay/snapshot-replace
- `apps/hakka/Tests/CoreTests/ServerTests.swift`, `BridgeSocketTests.swift` — decode, hub relay, and a real-socket end-to-end proof via `HakkaBridgeClient.sendStorage`
- `ios/Tests/HakkaTests/HakkaBridgeClientTests.swift` — wire-frame encoding + `HakkaInterceptor.publishStorageSnapshot`

## Limits & non-goals

- No dangerous permissions on Android — `SharedPreferences` files live in the app's own sandbox,
  so the panel only ever reads its own app's data.
- iOS's `StorageView` covers `UserDefaults` only — Keychain and file-based storage are out of
  scope.
- Web's cookie writer cannot set or read `HttpOnly` cookies — that flag is server-only by design;
  every entry the panel shows is, by construction, one JS already fully controls.
- RN's `StorageType` union includes `'Zustand' | 'Redux' | 'Context'` as forward-declared
  categories in the type, but the shipped monitor hooks only patch AsyncStorage and MMKV today.
