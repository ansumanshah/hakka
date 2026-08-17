import { describe, expect, test } from 'bun:test'

import {
  adoptOtelTraceId,
  buildTraceparent,
  cohortGate,
  currentServerTraceId,
  currentTraceContext,
  parseIncomingTraceId,
  parseRequestKindHint,
  parseTraceparent,
  runInTraceContext,
} from '../trace'

describe('parseTraceparent', () => {
  test('parses a well-formed header and returns the lowercased trace-id', () => {
    const id = parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01')
    expect(id).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  test('returns undefined for a missing header', () => {
    expect(parseTraceparent(undefined)).toBeUndefined()
  })

  test('rejects malformed headers (wrong segment lengths, extra segments, garbage)', () => {
    expect(parseTraceparent('not-a-traceparent')).toBeUndefined()
    expect(parseTraceparent('00-tooshort-00f067aa0ba902b7-01')).toBeUndefined()
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7')).toBeUndefined()
    expect(parseTraceparent('')).toBeUndefined()
  })

  test('rejects the reserved all-zero trace-id and parent-id', () => {
    expect(parseTraceparent(`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`)).toBeUndefined()
    expect(parseTraceparent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`)).toBeUndefined()
  })

  test('rejects the forbidden ff version', () => {
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeUndefined()
  })
})

describe('parseIncomingTraceId', () => {
  test('prefers x-hakka-trace over traceparent when both are present', () => {
    const id = parseIncomingTraceId({
      'x-hakka-trace': 'my-own-id',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    })
    expect(id).toBe('my-own-id')
  })

  test('falls back to traceparent when x-hakka-trace is absent', () => {
    const id = parseIncomingTraceId({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' })
    expect(id).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  test('returns undefined when neither header is present or traceparent is malformed', () => {
    expect(parseIncomingTraceId({})).toBeUndefined()
    expect(parseIncomingTraceId(undefined)).toBeUndefined()
    expect(parseIncomingTraceId({ traceparent: 'garbage' })).toBeUndefined()
  })

  test('unwraps array header values (Node lowercases + arrays duplicate headers)', () => {
    expect(parseIncomingTraceId({ 'x-hakka-trace': ['first', 'second'] })).toBe('first')
  })
})

describe('buildTraceparent', () => {
  test('produces a well-formed, valid traceparent (round-trips through parseTraceparent)', () => {
    const header = buildTraceparent('T-CLIENT')
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(parseTraceparent(header)).toBeTruthy()
  })

  test('the same correlationId always derives the same trace-id segment (stable hash)', () => {
    const a = buildTraceparent('T-CLIENT')
    const b = buildTraceparent('T-CLIENT')
    const traceIdOf = (h: string) => h.split('-')[1]
    expect(traceIdOf(a)).toBe(traceIdOf(b))
    // But the span-id (each hop's own id) varies per call.
    const spanIdOf = (h: string) => h.split('-')[2]
    expect(spanIdOf(a)).not.toBe(spanIdOf(b))
  })

  test('a UUID-shaped correlationId round-trips as its own trace-id (dashes stripped)', () => {
    const uuid = '4bf92f35-77b3-4da6-a3ce-929d0e0e4736'
    const header = buildTraceparent(uuid)
    expect(header).toContain('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  test('different correlationIds derive different trace-ids', () => {
    const a = buildTraceparent('trace-a')
    const b = buildTraceparent('trace-b')
    expect(a.split('-')[1]).not.toBe(b.split('-')[1])
  })

  test('the trace-id cache stays correct across a burst that forces an internal clear()', () => {
    // One incoming request fanning out to many upstream hops re-derives the
    // same correlationId's trace-id repeatedly — this drives the cache past
    // its cap (512) and back out the other side, then confirms an id seen
    // before the clear still recomputes to the identical segment afterward.
    const traceIdOf = (h: string) => h.split('-')[1]

    const preClearId = 'burst-client-0'
    const preClearTraceId = traceIdOf(buildTraceparent(preClearId))

    for (let i = 1; i < 600; i++) buildTraceparent(`burst-client-${i}`)

    expect(traceIdOf(buildTraceparent(preClearId))).toBe(preClearTraceId)
  })
})

// Cross-environment parity: `buildTraceparent`/`deriveTraceId` now live in
// hakka-core's `engine/traceparent` (pure JS, no `node:crypto`) so the
// browser can call the SAME function hakka-node re-exports here — see that
// module's doc. This proves the pure-JS SHA-256 fallback branch is
// byte-for-byte identical to an independent `node:crypto` computation of the
// exact same algorithm, for a set of non-UUID, non-32-hex correlationIds
// (the only branch that isn't a trivial passthrough/dash-strip).
describe('deriveTraceId / node:crypto parity (browser-safe path vs node path)', () => {
  test('the pure-JS SHA-256 fallback matches node:crypto createHash("sha256") byte-for-byte', async () => {
    const { createHash } = await import('node:crypto')
    const inputs = [
      'not-a-uuid',
      'trace-a',
      'trace-b',
      '',
      'abc',
      'a very long correlation id with spaces & punctuation!',
    ]

    for (const input of inputs) {
      const viaBuildTraceparent = buildTraceparent(input).split('-')[1]
      const viaNodeCrypto = createHash('sha256').update(input).digest('hex').slice(0, 32)
      expect(viaBuildTraceparent).toBe(viaNodeCrypto)
    }
  })

  test('UUID and 32-hex correlationIds take the passthrough/dash-strip branch, not the hash branch', () => {
    const uuid = '4bf92f35-77b3-4da6-a3ce-929d0e0e4736'
    expect(buildTraceparent(uuid).split('-')[1]).toBe('4bf92f3577b34da6a3ce929d0e0e4736')

    const hex32 = '3037e8f4e14c65fc97fb7dae597b053a'
    expect(buildTraceparent(hex32).split('-')[1]).toBe(hex32)
  })
})

describe('runInTraceContext / currentTraceContext / cohortGate', () => {
  test('runInTraceContext propagates both traceId and debug to currentTraceContext()', () => {
    expect(currentTraceContext()).toBeUndefined() // nothing active outside any run()

    runInTraceContext({ traceId: 'T-COHORT', debug: true }, () => {
      expect(currentTraceContext()).toEqual({ traceId: 'T-COHORT', debug: true })
    })

    expect(currentTraceContext()).toBeUndefined() // context ends with the callback
  })

  test('currentServerTraceId stays back-compat: returns just the .traceId string', () => {
    runInTraceContext({ traceId: 'T-BACKCOMPAT', debug: true }, () => {
      expect(currentServerTraceId()).toBe('T-BACKCOMPAT')
    })
  })

  test('runInTraceContext propagates across async boundaries (AsyncLocalStorage semantics)', async () => {
    await runInTraceContext({ traceId: 'T-ASYNC', debug: false }, async () => {
      await new Promise((r) => setTimeout(r, 5))
      expect(currentTraceContext()).toEqual({ traceId: 'T-ASYNC', debug: false })
    })
  })

  test('cohortGate() returns true only while debug: true is active, independent of traceId', () => {
    const gate = cohortGate()
    expect(gate()).toBe(false) // no context at all

    runInTraceContext({ traceId: 'T-NOT-COHORT' }, () => {
      expect(gate()).toBe(false) // traceId present, but no debug flag
    })

    runInTraceContext({ traceId: 'T-NOT-COHORT-2', debug: false }, () => {
      expect(gate()).toBe(false) // explicit debug: false
    })

    runInTraceContext({ traceId: 'T-COHORT-2', debug: true }, () => {
      expect(gate()).toBe(true)
    })
  })

  test('a nested runInTraceContext temporarily overrides the outer context (standard ALS nesting)', () => {
    runInTraceContext({ traceId: 'OUTER', debug: false }, () => {
      expect(currentTraceContext()).toEqual({ traceId: 'OUTER', debug: false })
      runInTraceContext({ traceId: 'INNER', debug: true }, () => {
        expect(currentTraceContext()).toEqual({ traceId: 'INNER', debug: true })
      })
      // Back to the outer context once the inner run() returns.
      expect(currentTraceContext()).toEqual({ traceId: 'OUTER', debug: false })
    })
  })
})

describe('parseRequestKindHint', () => {
  test('next-action header wins over rsc:1 when both are present', () => {
    expect(parseRequestKindHint({ 'next-action': 'abc123', rsc: '1' })).toBe('server-action')
  })

  test('rsc:1 alone maps to "rsc"', () => {
    expect(parseRequestKindHint({ rsc: '1' })).toBe('rsc')
  })

  test('returns undefined when neither header is present, or rsc has a non-"1" value', () => {
    expect(parseRequestKindHint({})).toBeUndefined()
    expect(parseRequestKindHint(undefined)).toBeUndefined()
    expect(parseRequestKindHint({ rsc: '0' })).toBeUndefined()
  })
})

describe('adoptOtelTraceId', () => {
  test('is a no-op when a trace context already exists — never overwrites a header-derived correlationId', () => {
    runInTraceContext({ traceId: 'header-derived' }, () => {
      adoptOtelTraceId('otel-trace-should-be-ignored')
      expect(currentTraceContext()).toEqual({ traceId: 'header-derived' })
    })
  })

  // Placed last in the file: `store.enterWith` (unlike `store.run`) mutates the
  // ACTIVE execution context in place rather than scoping to a callback, so —
  // per Node's AsyncLocalStorage semantics — it can outlive this test's own
  // synchronous body. Every other test above establishes its own scope via
  // `runInTraceContext` (`store.run`), which always restores the prior context
  // on return, so this is the only place in the file where that matters.
  test('adopts otelTraceId when no trace context exists yet — the pure SSR/document-navigation case', () => {
    expect(currentTraceContext()).toBeUndefined()
    adoptOtelTraceId('otel-trace-adopted')
    expect(currentTraceContext()).toEqual({ traceId: 'otel-trace-adopted' })
  })
})
