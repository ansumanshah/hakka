import { describe, expect, test } from 'bun:test'

import type { FrameworkSpan, NetworkRequest } from '../../model/types'
import { assembleTraceTree } from '../traceTree'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: over.id ?? 'r1',
    url: over.url ?? 'https://api.example.com/users',
    method: over.method ?? 'GET',
    status: over.status ?? 200,
    startTime: over.startTime ?? 0,
    runtime: over.runtime ?? 'client',
    ...over,
  }
}

function span(over: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id: over.id ?? 's1',
    traceId: over.traceId ?? 't1',
    parentId: over.parentId ?? null,
    name: over.name ?? 'BaseServer.handleRequest',
    startTime: over.startTime ?? 0,
    endTime: over.endTime ?? 10,
    verbosity: over.verbosity ?? 'primary',
    runtime: over.runtime ?? 'server',
    ...over,
  }
}

describe('assembleTraceTree', () => {
  test('empty spans degrades to hop-only order identical to today', () => {
    const requests = [req({ id: 'a', startTime: 10, endTime: 30 }), req({ id: 'b', startTime: 0, endTime: 20 })]
    const tree = assembleTraceTree(requests, [])
    expect(tree.bars.map((b) => b.id)).toEqual(['b', 'a'])
    expect(tree.bars.every((b) => b.kind === 'request' && b.depth === 0)).toBe(true)
    expect(tree.t0).toBe(0)
    expect(tree.t1).toBe(30)
  })

  test('depth computed correctly for a 3-level span chain', () => {
    const spans = [
      span({ id: 'root', parentId: null, startTime: 0, endTime: 100 }),
      span({ id: 'mid', parentId: 'root', startTime: 10, endTime: 90 }),
      span({ id: 'leaf', parentId: 'mid', startTime: 20, endTime: 80 }),
    ]
    const tree = assembleTraceTree([], spans)
    const byId = new Map(tree.bars.map((b) => [b.id, b]))
    expect(byId.get('root')?.depth).toBe(0)
    expect(byId.get('mid')?.depth).toBe(1)
    expect(byId.get('leaf')?.depth).toBe(2)
  })

  test('a cyclic/malformed parentId chain never infinite-loops', () => {
    const spans = [
      span({ id: 'a', parentId: 'b', startTime: 0, endTime: 10 }),
      span({ id: 'b', parentId: 'a', startTime: 0, endTime: 10 }),
    ]
    // The assertion itself is termination — bun:test would hang/time out on
    // an infinite loop, so simply completing and returning both bars proves
    // the cycle guard works. Exact depth values are not load-bearing (a
    // cycle is malformed input; only "finite and deterministic" matters).
    const tree = assembleTraceTree([], spans)
    expect(tree.bars.length).toBe(2)
    const byId = new Map(tree.bars.map((b) => [b.id, b]))
    expect(typeof byId.get('a')?.depth).toBe('number')
    expect(typeof byId.get('b')?.depth).toBe('number')
  })

  test('an unresolvable parentId (not in this trace) falls back to depth 0', () => {
    const spans = [span({ id: 'orphan', parentId: 'missing-parent', startTime: 0, endTime: 10 })]
    const tree = assembleTraceTree([], spans)
    expect(tree.bars[0]?.depth).toBe(0)
  })

  test('verbose filtering drops non-primary spans by default', () => {
    const spans = [span({ id: 'primary', verbosity: 'primary' }), span({ id: 'verbose', verbosity: 'verbose' })]
    const defaultTree = assembleTraceTree([], spans)
    expect(defaultTree.bars.map((b) => b.id)).toEqual(['primary'])

    const verboseTree = assembleTraceTree([], spans, { verbose: true })
    expect(verboseTree.bars.map((b) => b.id).sort()).toEqual(['primary', 'verbose'])
  })

  test('a verbose-only child of a primary parent nests under its nearest visible ancestor', () => {
    const spans = [
      span({ id: 'root', parentId: null, verbosity: 'primary', startTime: 0, endTime: 100 }),
      span({ id: 'noise', parentId: 'root', verbosity: 'verbose', startTime: 10, endTime: 90 }),
      span({ id: 'child', parentId: 'noise', verbosity: 'primary', startTime: 20, endTime: 80 }),
    ]
    // Non-verbose view: 'noise' is filtered out of the bar list, but depth is
    // still walked against the full span set — 'child's true ancestor is
    // 'root' via the hidden 'noise' hop, so it nests one level under root
    // (depth 1) rather than collapsing to depth 0 as if it were a root/sibling.
    const tree = assembleTraceTree([], spans)
    const byId = new Map(tree.bars.map((b) => [b.id, b]))
    expect(byId.get('noise')).toBeUndefined() // filtered out of the visible bar list
    expect(byId.get('root')?.depth).toBe(0)
    expect(byId.get('child')?.depth).toBe(1)
  })

  test('a chain of multiple hidden ancestors is fully transparent for nesting', () => {
    const spans = [
      span({ id: 'root', parentId: null, verbosity: 'primary', startTime: 0, endTime: 100 }),
      span({ id: 'noise1', parentId: 'root', verbosity: 'verbose', startTime: 5, endTime: 95 }),
      span({ id: 'noise2', parentId: 'noise1', verbosity: 'verbose', startTime: 10, endTime: 90 }),
      span({ id: 'child', parentId: 'noise2', verbosity: 'primary', startTime: 20, endTime: 80 }),
    ]
    const tree = assembleTraceTree([], spans)
    const byId = new Map(tree.bars.map((b) => [b.id, b]))
    expect(byId.get('root')?.depth).toBe(0)
    expect(byId.get('child')?.depth).toBe(1)
  })

  test('verbose mode treats every span as visible, so depth matches the plain ancestor chain', () => {
    const spans = [
      span({ id: 'root', parentId: null, verbosity: 'primary', startTime: 0, endTime: 100 }),
      span({ id: 'noise', parentId: 'root', verbosity: 'verbose', startTime: 10, endTime: 90 }),
      span({ id: 'child', parentId: 'noise', verbosity: 'primary', startTime: 20, endTime: 80 }),
    ]
    const tree = assembleTraceTree([], spans, { verbose: true })
    const byId = new Map(tree.bars.map((b) => [b.id, b]))
    expect(byId.get('root')?.depth).toBe(0)
    expect(byId.get('noise')?.depth).toBe(1)
    expect(byId.get('child')?.depth).toBe(2)
  })

  test('empty requests and spans returns an empty, zero-span tree', () => {
    const tree = assembleTraceTree([], [])
    expect(tree.bars).toEqual([])
    expect(tree.t0).toBe(0)
    expect(tree.t1).toBe(0)
  })

  test('merges requests and spans on one sorted timeline', () => {
    const requests = [req({ id: 'hop', startTime: 5, endTime: 15 })]
    const spans = [span({ id: 'span', startTime: 0, endTime: 20 })]
    const tree = assembleTraceTree(requests, spans)
    expect(tree.bars.map((b) => b.id)).toEqual(['span', 'hop'])
    expect(tree.bars.find((b) => b.id === 'hop')?.kind).toBe('request')
    expect(tree.bars.find((b) => b.id === 'span')?.kind).toBe('span')
  })
})
