import { describe, expect, it } from 'bun:test'

import { parseRangeFilters, parseSearchTokens, parseStatusDsl } from '../parser'

describe('parseStatusDsl', () => {
  describe('class notation', () => {
    it('2xx → [200, 299]', () => expect(parseStatusDsl('2xx')).toEqual([200, 299]))
    it('2XX → [200, 299]', () => expect(parseStatusDsl('2XX')).toEqual([200, 299]))
    it('1xx → [100, 199]', () => expect(parseStatusDsl('1xx')).toEqual([100, 199]))
    it('3xx → [300, 399]', () => expect(parseStatusDsl('3xx')).toEqual([300, 399]))
    it('4xx → [400, 499]', () => expect(parseStatusDsl('4xx')).toEqual([400, 499]))
    it('5xx → [500, 599]', () => expect(parseStatusDsl('5xx')).toEqual([500, 599]))
    it('5Xx → [500, 599]', () => expect(parseStatusDsl('5Xx')).toEqual([500, 599]))
  })

  describe('inclusive range "200..299"', () => {
    it('200..299 → [200, 299]', () => expect(parseStatusDsl('200..299')).toEqual([200, 299]))
    it('200..200 → [200, 200]', () => expect(parseStatusDsl('200..200')).toEqual([200, 200]))
    it('400..500 → [400, 500]', () => expect(parseStatusDsl('400..500')).toEqual([400, 500]))
    it('inverted range → null', () => expect(parseStatusDsl('500..400')).toBeNull())
  })

  describe('exclusive upper range "200..<300"', () => {
    it('200..<300 → [200, 299]', () => expect(parseStatusDsl('200..<300')).toEqual([200, 299]))
    it('400..<500 → [400, 499]', () => expect(parseStatusDsl('400..<500')).toEqual([400, 499]))
    it('inverted exclusive → null', () => expect(parseStatusDsl('300..<200')).toBeNull())
  })

  describe('>= / > operators', () => {
    it('>=400 → [400, 599]', () => expect(parseStatusDsl('>=400')).toEqual([400, 599]))
    it('>400 → [401, 599]', () => expect(parseStatusDsl('>400')).toEqual([401, 599]))
    it('>=200 → [200, 599]', () => expect(parseStatusDsl('>=200')).toEqual([200, 599]))
    it('>100 → [101, 599]', () => expect(parseStatusDsl('>100')).toEqual([101, 599]))
  })

  describe('<= / < operators', () => {
    it('<=404 → [100, 404]', () => expect(parseStatusDsl('<=404')).toEqual([100, 404]))
    it('<500 → [100, 499]', () => expect(parseStatusDsl('<500')).toEqual([100, 499]))
    it('<=200 → [100, 200]', () => expect(parseStatusDsl('<=200')).toEqual([100, 200]))
    it('<200 → [100, 199]', () => expect(parseStatusDsl('<200')).toEqual([100, 199]))
  })

  describe('exact code', () => {
    it('404 → [404, 404]', () => expect(parseStatusDsl('404')).toEqual([404, 404]))
    it('200 → [200, 200]', () => expect(parseStatusDsl('200')).toEqual([200, 200]))
    it('500 → [500, 500]', () => expect(parseStatusDsl('500')).toEqual([500, 500]))
  })

  describe('unrecognised input → null', () => {
    it('empty string → null', () => expect(parseStatusDsl('')).toBeNull())
    it('random text → null', () => expect(parseStatusDsl('ok')).toBeNull())
    it('6xx → null', () => expect(parseStatusDsl('6xx')).toBeNull())
    it('20 → null', () => expect(parseStatusDsl('20')).toBeNull())
    it('whitespace → null', () => expect(parseStatusDsl('   ')).toBeNull())
  })

  it('trims whitespace', () => expect(parseStatusDsl('  404  ')).toEqual([404, 404]))
})

describe('parseSearchTokens', () => {
  it('empty string → []', () => expect(parseSearchTokens('')).toEqual([]))
  it('whitespace only → []', () => expect(parseSearchTokens('   ')).toEqual([]))

  describe('default (all scope, substring mode)', () => {
    it('single word', () => {
      expect(parseSearchTokens('hello')).toEqual([{ scope: 'all', mode: 'substring', value: 'hello', negate: false }])
    })

    it('multiple words → multiple tokens', () => {
      const tokens = parseSearchTokens('foo bar')
      expect(tokens).toHaveLength(2)
      expect(tokens[0]).toMatchObject({ value: 'foo', scope: 'all', negate: false })
      expect(tokens[1]).toMatchObject({ value: 'bar', scope: 'all', negate: false })
    })
  })

  describe('quoted phrases', () => {
    it('double-quoted phrase stays whole', () => {
      expect(parseSearchTokens('"hello world"')).toEqual([
        { scope: 'all', mode: 'substring', value: 'hello world', negate: false },
      ])
    })

    it('single-quoted phrase stays whole', () => {
      expect(parseSearchTokens("'foo bar'")).toEqual([
        { scope: 'all', mode: 'substring', value: 'foo bar', negate: false },
      ])
    })

    it('mixed quoted and unquoted', () => {
      const tokens = parseSearchTokens('baz "foo bar"')
      expect(tokens).toHaveLength(2)
      expect(tokens[0]).toMatchObject({ value: 'baz' })
      expect(tokens[1]).toMatchObject({ value: 'foo bar' })
    })
  })

  describe('scope prefixes', () => {
    it('url: prefix → url scope', () => {
      expect(parseSearchTokens('url:example.com')).toEqual([
        { scope: 'url', mode: 'substring', value: 'example.com', negate: false },
      ])
    })

    it('header: prefix → header scope', () => {
      expect(parseSearchTokens('header:content-type')).toEqual([
        { scope: 'header', mode: 'substring', value: 'content-type', negate: false },
      ])
    })

    it('headers: (plural) → header scope', () => {
      expect(parseSearchTokens('headers:authorization')).toEqual([
        { scope: 'header', mode: 'substring', value: 'authorization', negate: false },
      ])
    })

    it('body: prefix → body scope', () => {
      expect(parseSearchTokens('body:userId')).toEqual([
        { scope: 'body', mode: 'substring', value: 'userId', negate: false },
      ])
    })

    it('prefix is case-insensitive', () => {
      expect(parseSearchTokens('URL:test')).toEqual([{ scope: 'url', mode: 'substring', value: 'test', negate: false }])
    })
  })

  describe('negate with leading -', () => {
    it('-foo → negate: true', () => {
      expect(parseSearchTokens('-foo')).toEqual([{ scope: 'all', mode: 'substring', value: 'foo', negate: true }])
    })

    it('-url:example.com → negated url scope', () => {
      expect(parseSearchTokens('-url:example.com')).toEqual([
        { scope: 'url', mode: 'substring', value: 'example.com', negate: true },
      ])
    })

    it('not negated without value after dash', () => {
      // just "-" alone produces an empty token that should be skipped
      const tokens = parseSearchTokens('-')
      expect(tokens).toHaveLength(0)
    })
  })

  describe('regex mode', () => {
    it('/pattern/ → regex mode', () => {
      expect(parseSearchTokens('/api\\/v[0-9]+/')).toEqual([
        { scope: 'all', mode: 'regex', value: 'api\\/v[0-9]+', negate: false },
      ])
    })

    it('/re/ with scope', () => {
      expect(parseSearchTokens('url:/example/')).toEqual([
        { scope: 'url', mode: 'regex', value: 'example', negate: false },
      ])
    })

    it('negated regex', () => {
      expect(parseSearchTokens('-/health/')).toEqual([{ scope: 'all', mode: 'regex', value: 'health', negate: true }])
    })
  })

  describe('wildcard mode', () => {
    it('*glob* → wildcard mode', () => {
      expect(parseSearchTokens('*api*')).toEqual([{ scope: 'all', mode: 'wildcard', value: '*api*', negate: false }])
    })

    it('api/* → wildcard mode', () => {
      expect(parseSearchTokens('api/*')).toEqual([{ scope: 'all', mode: 'wildcard', value: 'api/*', negate: false }])
    })

    it('? alone → wildcard', () => {
      expect(parseSearchTokens('hel?o')).toEqual([{ scope: 'all', mode: 'wildcard', value: 'hel?o', negate: false }])
    })
  })

  describe('combined tokens', () => {
    it('multiple scopes and modes', () => {
      const tokens = parseSearchTokens('url:/api/ -body:password header:content-type')
      expect(tokens).toHaveLength(3)
      expect(tokens[0]).toMatchObject({ scope: 'url', mode: 'regex', value: 'api', negate: false })
      expect(tokens[1]).toMatchObject({ scope: 'body', mode: 'substring', value: 'password', negate: true })
      expect(tokens[2]).toMatchObject({ scope: 'header', mode: 'substring', value: 'content-type', negate: false })
    })
  })
})

describe('parseRangeFilters', () => {
  it('extracts strict duration bounds and strips them from the text', () => {
    const { ranges, rest } = parseRangeFilters('login dur>100 dur<500')
    expect(ranges.durationMin).toBe(101)
    expect(ranges.durationMax).toBe(499)
    expect(rest).toBe('login')
  })

  it('handles inclusive bounds and the `duration` alias', () => {
    const { ranges } = parseRangeFilters('duration>=200 dur<=800')
    expect(ranges.durationMin).toBe(200)
    expect(ranges.durationMax).toBe(800)
  })

  it('parses size with kb/mb units into bytes', () => {
    const { ranges, rest } = parseRangeFilters('api size>1kb size<2mb')
    expect(ranges.sizeMin).toBe(1025) // strict > 1024
    expect(ranges.sizeMax).toBe(2 * 1024 * 1024 - 1)
    expect(rest).toBe('api')
  })

  it('returns no ranges and the original text when there are no range tokens', () => {
    const { ranges, rest } = parseRangeFilters('url:api /err/')
    expect(ranges).toEqual({})
    expect(rest).toBe('url:api /err/')
  })
})
