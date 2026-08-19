import { compileQuery, parseSearchTokens } from 'hakka-core'
import { describe, it, expect } from 'vitest'

import { makeReq } from './requestListFixtures'

describe('compileQuery advanced search', () => {
  it('filters by scoped url: token', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users' })
    const b = makeReq('b', { url: 'https://cdn.example.com/image.png' })
    const match = compileQuery({ tokens: parseSearchTokens('url:/users') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })

  it('filters with /regex/ notation', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users' })
    const b = makeReq('b', { url: 'https://api.example.com/orders' })
    const match = compileQuery({ tokens: parseSearchTokens('/user/') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })

  it('supports negation with -prefix', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users' })
    const b = makeReq('b', { url: 'https://api.example.com/orders' })
    const match = compileQuery({ tokens: parseSearchTokens('-orders') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })

  it('filters via *glob* wildcard', () => {
    const a = makeReq('a', { url: 'https://api.example.com/users/123' })
    const b = makeReq('b', { url: 'https://cdn.example.com/logo.png' })
    const match = compileQuery({ tokens: parseSearchTokens('*api*users*') })
    expect([a, b].filter(match).map((r) => r.id)).toEqual(['a'])
  })
})
