---
title: Resilience
description: Spec card — crash containment (root error boundary around the web and RN inspectors) and stale-body revalidation in the Detail view.
---

## What it does

Two behaviors keep the inspector a safe guest in a host app:

- **Crash containment.** The web overlay wraps the entire inspector in a root error
  boundary (`CrashBoundary.tsx`, Solid's `<Errored>`). If the inspector crashes, the
  host page keeps running untouched — a compact "Inspector crashed — reload" bar
  renders inside the inspector's own shadow root. Reload is a real teardown: the
  entire crashed tree is disposed and a fresh one is mounted, rather than re-rendering
  inside a possibly-corrupted reactive root. Captured traffic survives the reload —
  the store lives outside the UI tree (Web Worker / module singleton). React Native
  uses the native iOS and Android inspector surfaces, which follow the host app's
  native exception model and do not add a JS error boundary. Captured traffic remains
  in the module-level `hakka-core` store.
- **Stale-body revalidation.** Switching rows in Detail keeps the previous request's
  body visible (dimmed) while the next body hydrates asynchronously, instead of
  flashing "No request/response body" mid-fetch. Superseded fetches are discarded, so
  a stale body never renders against the wrong request.

## Platform matrix

| Capability              | RN  | iOS | Android | Web | Mac app |
| ----------------------- | --- | --- | ------- | --- | ------- |
| Crash containment       | ●   | —   | —       | ●   | —       |
| Stale-body revalidation | ○   | ⊘   | ⊘       | ●   | ⊘       |

iOS/Android native panels read bodies in-process with no async gap, so stale-body
revalidation has nothing to revalidate (out of scope by design), and inspector crash
containment rides the host app's native exception model instead of a boundary like
web/RN's. RN's stale-body revalidation (async bridge body fetch) is still roadmap.

## Limits & non-goals

- Both boundaries catch synchronous render/update throws (Solid-managed async
  rejections too, on web). Detached raw-async throws (a bare `setTimeout` callback, an
  unmanaged `.then()`) bypass any error boundary — universal error-boundary behavior,
  not specific to either implementation.
- Reload rebuilds UI state (open tab, filters revert to persisted values); it does not
  clear captured traffic.

## Test anchors

- `packages/hakka-browser/src/ui/__tests__/CrashBoundary.test.tsx`
- `packages/hakka-browser/src/ui/__tests__/Detail.bodyHydration.test.tsx`
- `packages/hakka-react-native/src/ui/__tests__/CrashBoundary.test.tsx`
