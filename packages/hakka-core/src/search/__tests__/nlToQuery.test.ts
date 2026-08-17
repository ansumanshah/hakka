import { describe, expect, test } from 'bun:test'

import { nlToQuery } from '../nlToQuery'

describe('nlToQuery — empty input', () => {
  test('empty string returns empty string', () => {
    expect(nlToQuery('')).toBe('')
  })

  test('whitespace-only string returns empty string', () => {
    expect(nlToQuery('   ')).toBe('')
  })
})

describe('nlToQuery — failures / errors', () => {
  test('"failed" maps to an error status range', () => {
    expect(nlToQuery('failed requests')).toContain('status:>=400')
  })

  test('"errors" maps to an error status range', () => {
    expect(nlToQuery('show me errors')).toContain('status:>=400')
  })
})

describe('nlToQuery — auth', () => {
  test('"auth" maps to the 401..403 status range', () => {
    expect(nlToQuery('auth issues')).toContain('status:401..403')
  })

  test('an explicit 401 maps to status:401', () => {
    expect(nlToQuery('401 requests')).toContain('status:401')
  })

  test('an explicit 403 maps to status:403', () => {
    expect(nlToQuery('403 errors')).toContain('status:403')
  })
})

describe('nlToQuery — slow / duration', () => {
  test('"slow" maps to a generic duration threshold', () => {
    expect(nlToQuery('slow requests')).toContain('dur>500')
  })

  test('"slower than 500ms" maps to an explicit dur> token', () => {
    expect(nlToQuery('slower than 500ms')).toContain('dur>500')
  })

  test('"slower than 2s" converts seconds to milliseconds', () => {
    expect(nlToQuery('slower than 2s')).toContain('dur>2000')
  })

  test('"faster than 100ms" maps to dur<', () => {
    expect(nlToQuery('faster than 100ms')).toContain('dur<100')
  })
})

describe('nlToQuery — size', () => {
  test('"large" maps to a generic size threshold', () => {
    expect(nlToQuery('large responses')).toContain('size>1mb')
  })

  test('"bigger than 500kb" maps to an explicit size> token', () => {
    expect(nlToQuery('bigger than 500kb')).toContain('size>500kb')
  })
})

describe('nlToQuery — HTTP methods', () => {
  test('"POST" maps to method:POST', () => {
    expect(nlToQuery('POST requests')).toContain('method:POST')
  })

  test('"GET" maps to method:GET', () => {
    expect(nlToQuery('GET requests to the api')).toContain('method:GET')
  })

  test('lowercase "post" also maps to method:POST', () => {
    expect(nlToQuery('post requests')).toContain('method:POST')
  })
})

describe('nlToQuery — url / hostname', () => {
  test('a bare hostname maps to a url: token', () => {
    expect(nlToQuery('requests to api.example.com')).toContain('url:api.example.com')
  })

  test('a bare path maps to a url: token', () => {
    expect(nlToQuery('calls to /checkout')).toContain('url:/checkout')
  })
})

describe('nlToQuery — combined phrases', () => {
  test('"slow POSTs to /checkout" combines duration + method + url tokens', () => {
    const dsl = nlToQuery('slow POSTs to /checkout')
    expect(dsl).toContain('dur>500')
    expect(dsl).toContain('method:POST')
    expect(dsl).toContain('url:/checkout')
  })

  test('"failed auth requests" combines both status-affecting rules', () => {
    const dsl = nlToQuery('failed auth requests')
    expect(dsl.length).toBeGreaterThan(0)
    expect(dsl).toMatch(/status:/)
  })
})

describe('nlToQuery — unknown words fall through', () => {
  test('an unrecognised word is preserved as a plain substring term', () => {
    expect(nlToQuery('checkout')).toBe('checkout')
  })

  test('stopwords are stripped from the plain-text fallback', () => {
    const dsl = nlToQuery('show me all the requests')
    expect(dsl).not.toContain('show')
    expect(dsl).not.toContain('all')
  })
})
