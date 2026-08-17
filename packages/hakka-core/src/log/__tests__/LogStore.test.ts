import { describe, expect, test } from 'bun:test'

import { LogStore } from '../LogStore'
import type { LogEntry } from '../types'

function entry(id: string, over: Partial<LogEntry> = {}): LogEntry {
  return { id, timestamp: 1000, level: 'info', message: `msg-${id}`, ...over }
}

describe('LogStore — basics', () => {
  test('add then getEntries', () => {
    const store = new LogStore(4)
    store.add(entry('a'))
    expect(store.getEntries().map((e) => e.id)).toEqual(['a'])
    expect(store.size()).toBe(1)
  })

  test('getEntries returns oldest→newest', () => {
    const store = new LogStore(4)
    store.add(entry('a'))
    store.add(entry('b'))
    store.add(entry('c'))
    expect(store.getEntries().map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  test('defaults to 500 max entries', () => {
    const store = new LogStore()
    for (let i = 0; i < 500; i++) store.add(entry(`e${i}`))
    expect(store.size()).toBe(500)
    store.add(entry('overflow'))
    expect(store.size()).toBe(500)
    expect(store.getEntries()[0]?.id).toBe('e1')
  })
})

describe('LogStore — ring-buffer eviction', () => {
  test('evicts oldest entry once over capacity', () => {
    const store = new LogStore(3)
    for (const id of ['a', 'b', 'c', 'd']) store.add(entry(id))
    expect(store.size()).toBe(3)
    expect(store.getEntries().map((e) => e.id)).toEqual(['b', 'c', 'd'])
  })

  test('keeps evicting correctly across multiple wraps', () => {
    const store = new LogStore(2)
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.add(entry(id))
    expect(store.size()).toBe(2)
    expect(store.getEntries().map((e) => e.id)).toEqual(['d', 'e'])
  })
})

describe('LogStore — subscribe / unsubscribe', () => {
  test('subscribers are notified on add', () => {
    const store = new LogStore(4)
    const seen: string[] = []
    store.subscribe((e) => seen.push(e.id))
    store.add(entry('a'))
    store.add(entry('b'))
    expect(seen).toEqual(['a', 'b'])
  })

  test('unsubscribe stops further notifications', () => {
    const store = new LogStore(4)
    const seen: string[] = []
    const off = store.subscribe((e) => seen.push(e.id))
    store.add(entry('a'))
    off()
    store.add(entry('b'))
    expect(seen).toEqual(['a'])
  })

  test('multiple listeners are all notified independently', () => {
    const store = new LogStore(4)
    const seenA: string[] = []
    const seenB: string[] = []
    store.subscribe((e) => seenA.push(e.id))
    const offB = store.subscribe((e) => seenB.push(e.id))
    store.add(entry('a'))
    offB()
    store.add(entry('b'))
    expect(seenA).toEqual(['a', 'b'])
    expect(seenB).toEqual(['a'])
  })
})

describe('LogStore — clear', () => {
  test('clear empties everything', () => {
    const store = new LogStore(4)
    store.add(entry('a'))
    store.add(entry('b'))
    store.clear()
    expect(store.size()).toBe(0)
    expect(store.getEntries()).toEqual([])
  })

  test('store is reusable after clear', () => {
    const store = new LogStore(4)
    store.add(entry('a'))
    store.clear()
    store.add(entry('b'))
    expect(store.getEntries().map((e) => e.id)).toEqual(['b'])
    expect(store.size()).toBe(1)
  })
})
