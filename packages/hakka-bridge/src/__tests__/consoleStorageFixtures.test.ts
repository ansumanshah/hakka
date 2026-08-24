/**
 * console/storage bridge-frame fixtures — proves `parseBridgeMessage` actually
 * decodes the pinned JSON in `fixtures/console/`/`fixtures/storage/`, not just
 * hand-typed literals that happen to mirror it (see `BridgeHub.test.ts`'s own
 * `consoleFrame`/`storageFrame` tests, which predate this file and stay —
 * they cover rejection paths and malformed-payload edge cases this file
 * doesn't touch).
 *
 * `fixtures/console/README.md` / `fixtures/storage/README.md` claim these
 * fixtures are "read by every runtime's tests (TypeScript in
 * packages/hakka-bridge, Swift in ios/Tests/HakkaTests and
 * apps/hakka/Tests/CoreTests)". This file is what makes that true on the
 * TypeScript side — deliberately placed here, not in `hakka-core` or
 * `hakka-browser`: `BridgeConsoleMessage`/`BridgeStorageMessage` and the
 * `parseBridgeMessage` decoder that actually validates their shape both live
 * in this package's `protocol.ts` (`LogEntry`/`StorageSnapshot` in
 * `hakka-core` are plain interfaces with no runtime decoder of their own;
 * `hakka-browser` is a capture SDK that sends these frames, never decodes
 * one). Mirrors `packages/hakka-core/src/engine/__tests__/controlFixtures.ts`'s
 * loader for `fixtures/control/`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BridgeConsoleMessage, BridgeStorageMessage } from '../protocol'
import { parseBridgeMessage } from '../protocol'

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'fixtures')

function readFixture(dir: 'console' | 'storage', name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_ROOT, dir, name), 'utf-8'))
}

describe('console fixtures (fixtures/console/) decode via parseBridgeMessage', () => {
  test('log-entry-minimal.json — required fields only, as the sole entry of a frame', () => {
    const entry = readFixture('console', 'log-entry-minimal.json')
    const msg = parseBridgeMessage(JSON.stringify({ type: 'console', payload: [entry] }))
    expect(msg?.type).toBe('console')
    expect((msg as BridgeConsoleMessage).payload).toEqual([entry])
  })

  test('log-entry-full.json — every optional field populated, as the sole entry of a frame', () => {
    const entry = readFixture('console', 'log-entry-full.json')
    const msg = parseBridgeMessage(JSON.stringify({ type: 'console', payload: [entry] }))
    expect(msg?.type).toBe('console')
    expect((msg as BridgeConsoleMessage).payload).toEqual([entry])
  })

  test('log-batch.json — the actual frame-payload shape, an array of two entries', () => {
    const batch = readFixture('console', 'log-batch.json') as unknown[]
    expect(batch).toHaveLength(2)
    const msg = parseBridgeMessage(JSON.stringify({ type: 'console', payload: batch }))
    expect(msg?.type).toBe('console')
    expect((msg as BridgeConsoleMessage).payload).toEqual(batch)
  })
})

describe('storage fixtures (fixtures/storage/) decode via parseBridgeMessage', () => {
  test('defaults-snapshot.json', () => {
    const snapshot = readFixture('storage', 'defaults-snapshot.json')
    const msg = parseBridgeMessage(JSON.stringify({ type: 'storage', payload: snapshot }))
    expect(msg?.type).toBe('storage')
    expect((msg as BridgeStorageMessage).payload).toEqual(snapshot)
  })

  test('keychain-redacted-snapshot.json — the redaction marker passes through untouched (already redacted upstream)', () => {
    const snapshot = readFixture('storage', 'keychain-redacted-snapshot.json') as { entries: Record<string, string> }
    expect(snapshot.entries.authToken).toBe('***REDACTED***')
    const msg = parseBridgeMessage(JSON.stringify({ type: 'storage', payload: snapshot }))
    expect(msg?.type).toBe('storage')
    expect((msg as BridgeStorageMessage).payload).toEqual(snapshot)
  })

  test('empty-snapshot.json — an empty entries object is a valid snapshot, not rejected as malformed', () => {
    const snapshot = readFixture('storage', 'empty-snapshot.json') as { entries: Record<string, string> }
    expect(snapshot.entries).toEqual({})
    const msg = parseBridgeMessage(JSON.stringify({ type: 'storage', payload: snapshot }))
    expect(msg?.type).toBe('storage')
    expect((msg as BridgeStorageMessage).payload).toEqual(snapshot)
  })
})
