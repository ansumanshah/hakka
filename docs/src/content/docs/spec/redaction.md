---
title: Redaction
description: Spec card — header-value redaction/stripping and JSON body field redaction applied before a request is stored.
---

## What it does

Redaction replaces sensitive header values and JSON body field values with `[REDACTED]` before
a captured request reaches the ring buffer or any sink — the key/field name is preserved, only
the value is blanked. Header matching supports exact names, glob (`x-*-token`), and regex
patterns; body redaction matches exact (case-insensitive) JSON key names, recursively, up to a
bounded depth.

## Public API

```ts
import { redactHeaders, stripHeaders, isSensitiveHeader, DEFAULT_SENSITIVE_HEADERS } from 'hakka-core'
import { configureBodyRedaction, getBodyRedactionFields, redactJsonBody } from 'hakka-core'

redactHeaders(headers, sensitiveHeaders?) // Record<string,string> — values → '[REDACTED]'
stripHeaders(headers, sensitiveHeaders?) // Record<string,string> — matching keys removed entirely
isSensitiveHeader(name, sensitiveHeaders?) // boolean

configureBodyRedaction(fields) // sets the module-level active field list; [] disables (zero overhead)
getBodyRedactionFields() // string[] (lowercased)
redactJsonBody(body, fields?) // string | null — non-JSON bodies pass through unchanged
```

## Config keys + defaults

`redactHeaders` is part of `HakkaConfig` / `DEFAULT_CONFIG`; body-field redaction is configured
separately (not a `HakkaConfig` key) via `configureBodyRedaction()`.

| Key                                                  | Default                                                                                                                                                                                                                                                                                                           | Description                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `redactHeaders` (`HakkaConfig`)                      | `['authorization', 'proxy-authorization', 'cookie', 'set-cookie']`                                                                                                                                                                                                                                                | Header names redacted on every captured request.                                                                                      |
| `DEFAULT_SENSITIVE_HEADERS` (util constant, broader) | `authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `x-auth-token`, `x-access-token`, `x-csrf-token`, `proxy-authorization`, `www-authenticate`, `x-token`, `token`, `x-secret`, `x-session-token`, `x-amz-security-token`, `private-token`, `x-client-secret`, `session`, `x-*-token`, `x-*-secret` | Used by `redactHeaders`/`stripHeaders`/`isSensitiveHeader` when no explicit list is passed — a superset of the `HakkaConfig` default. |
| Body redaction fields                                | `[]` (disabled)                                                                                                                                                                                                                                                                                                   | Set via `configureBodyRedaction(['password', 'token', ...])`.                                                                         |

## Platform matrix

Not a distinct row in SPEC §5 — verified directly against per-platform sources rather than a
table cell:

| Capability | RN  | iOS | Android | Web |
| ---------- | --- | --- | ------- | --- |
| Redaction  | ●   | ●   | ●       | ●   |

iOS ships `Network/Redaction.swift`; Android ships `hakka-common/LogRedaction.kt`
(`LogRedactionTest.kt`). Both apply header redaction on capture; body-field redaction is core-TS
only today (RN JS-mode, Web, Next.js) — no evidence of a native JSON-body-field redaction port
on iOS/Android.

## Wire format

Redaction happens before a record is built — a redacted value is stored as the literal string
`'[REDACTED]'` on the `NetworkRequest`/`ContractRecord`; there's no separate marker distinguishing
"redacted" from "the app actually sent this string."

## Test anchors

- `packages/hakka-core/src/utils/headerRedaction.test.ts`
- `packages/hakka-core/src/utils/bodyRedaction.test.ts`
- `ios/Tests/HakkaTests/HakkaInterceptorTests.swift`, `ios/Tests/HakkaTests/HakkaConfigTests.swift`
- `android/hakka-common/src/test/kotlin/com/noodleapps/hakka/LogRedactionTest.kt`

## Limits & non-goals

- Body redaction only walks parsed JSON (object/array) — non-JSON bodies (form-encoded, plain
  text, binary) are never redacted by `redactJsonBody`, and pass through unchanged.
- Matching is exact-name (case-insensitive) for body fields — no glob/regex support there, unlike
  header redaction.
- Recursion is bounded to `MAX_DEPTH = 100`; a value nested deeper than that is left unredacted
  rather than causing a stack overflow.
- Redaction is a value replace, not encryption — `[REDACTED]` is visible proof capture happened,
  not a way to recover the original value later.
