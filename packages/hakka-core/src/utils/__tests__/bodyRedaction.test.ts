import { describe, test, expect, beforeEach } from 'bun:test'

import { configureBodyRedaction, getBodyRedactionFields, redactJsonBody } from '../bodyRedaction'

beforeEach(() => {
  configureBodyRedaction([])
})

describe('configureBodyRedaction / getBodyRedactionFields', () => {
  test('defaults to empty (no redaction)', () => {
    expect(getBodyRedactionFields()).toEqual([])
  })

  test('stores lowercased fields', () => {
    configureBodyRedaction(['Password', 'SECRET', 'token'])
    expect(getBodyRedactionFields()).toEqual(['password', 'secret', 'token'])
  })

  test('can be reset to empty', () => {
    configureBodyRedaction(['password'])
    configureBodyRedaction([])
    expect(getBodyRedactionFields()).toEqual([])
  })
})

describe('redactJsonBody — null / empty / non-JSON', () => {
  test('null body returns null', () => {
    expect(redactJsonBody(null, ['password'])).toBeNull()
  })

  test('undefined body returns null', () => {
    expect(redactJsonBody(undefined, ['password'])).toBeNull()
  })

  test('empty string returns null', () => {
    expect(redactJsonBody('', ['password'])).toBeNull()
  })

  test('non-JSON string returned unchanged', () => {
    const plain = 'username=alice&password=secret'
    expect(redactJsonBody(plain, ['password'])).toBe(plain)
  })

  test('JSON primitive (number) returned unchanged', () => {
    expect(redactJsonBody('42', ['password'])).toBe('42')
  })

  test('JSON primitive (string) returned unchanged', () => {
    expect(redactJsonBody('"hello"', ['password'])).toBe('"hello"')
  })

  test('empty fields list — returns body unchanged', () => {
    const body = JSON.stringify({ password: 'secret', name: 'alice' })
    expect(redactJsonBody(body, [])).toBe(body)
  })
})

describe('redactJsonBody — flat object', () => {
  test('redacts a single sensitive key', () => {
    const body = JSON.stringify({ username: 'alice', password: 'hunter2' })
    const result = JSON.parse(redactJsonBody(body, ['password']) as string)
    expect(result.password).toBe('[REDACTED]')
    expect(result.username).toBe('alice')
  })

  test('case-insensitive key match — uppercase key in body, lowercase field', () => {
    const body = JSON.stringify({ Password: 'secret' })
    const result = JSON.parse(redactJsonBody(body, ['password']) as string)
    expect(result.Password).toBe('[REDACTED]')
  })

  test('case-insensitive key match — mixed case field config', () => {
    const body = JSON.stringify({ apiKey: 'abc123' })
    const result = JSON.parse(redactJsonBody(body, ['APIKEY']) as string)
    expect(result.apiKey).toBe('[REDACTED]')
  })

  test('preserves non-sensitive keys unchanged', () => {
    const body = JSON.stringify({ email: 'alice@example.com', token: 'xyz' })
    const result = JSON.parse(redactJsonBody(body, ['token']) as string)
    expect(result.email).toBe('alice@example.com')
    expect(result.token).toBe('[REDACTED]')
  })

  test('multiple sensitive keys all redacted', () => {
    const body = JSON.stringify({ password: 'p', secret: 's', name: 'alice' })
    const result = JSON.parse(redactJsonBody(body, ['password', 'secret']) as string)
    expect(result.password).toBe('[REDACTED]')
    expect(result.secret).toBe('[REDACTED]')
    expect(result.name).toBe('alice')
  })
})

describe('redactJsonBody — nested objects', () => {
  test('redacts a deeply nested sensitive key', () => {
    const body = JSON.stringify({
      user: {
        credentials: {
          password: 'super-secret',
          username: 'alice',
        },
      },
    })
    const result = JSON.parse(redactJsonBody(body, ['password']) as string) as {
      user: { credentials: { password: string; username: string } }
    }
    expect(result.user.credentials.password).toBe('[REDACTED]')
    expect(result.user.credentials.username).toBe('alice')
  })

  test('preserves object structure (shape-preserving)', () => {
    const body = JSON.stringify({
      a: { b: { c: { secret: 'shhh', keep: 42 } } },
    })
    const result = JSON.parse(redactJsonBody(body, ['secret']) as string) as {
      a: { b: { c: { secret: string; keep: number } } }
    }
    expect(result.a.b.c.secret).toBe('[REDACTED]')
    expect(result.a.b.c.keep).toBe(42)
  })
})

describe('redactJsonBody — arrays of objects', () => {
  test('redacts sensitive keys inside array elements', () => {
    const body = JSON.stringify([
      { id: 1, password: 'abc' },
      { id: 2, password: 'def' },
    ])
    const result = JSON.parse(redactJsonBody(body, ['password']) as string) as Array<{
      id: number
      password: string
    }>
    expect(result[0].password).toBe('[REDACTED]')
    expect(result[1].password).toBe('[REDACTED]')
    expect(result[0].id).toBe(1)
  })

  test('nested arrays of objects', () => {
    const body = JSON.stringify({
      users: [
        { name: 'alice', token: 'tok-a' },
        { name: 'bob', token: 'tok-b' },
      ],
    })
    const result = JSON.parse(redactJsonBody(body, ['token']) as string) as {
      users: Array<{ name: string; token: string }>
    }
    expect(result.users[0].token).toBe('[REDACTED]')
    expect(result.users[1].token).toBe('[REDACTED]')
    expect(result.users[0].name).toBe('alice')
  })

  test('top-level array of primitives left untouched', () => {
    const body = JSON.stringify([1, 2, 3])
    expect(redactJsonBody(body, ['password'])).toBe(body)
  })
})

describe('redactJsonBody — depth guard', () => {
  test('deeply nested object beyond MAX_DEPTH does not throw', () => {
    // Build an object nested 110 levels deep (> MAX_DEPTH=100)
    let obj: Record<string, unknown> = { password: 'leaf' }
    for (let i = 0; i < 110; i++) {
      obj = { child: obj }
    }
    const body = JSON.stringify(obj)
    // Must not throw; redaction may be partial beyond depth
    expect(() => redactJsonBody(body, ['password'])).not.toThrow()
  })
})

describe('redactJsonBody — uses module-level config', () => {
  test('uses configured fields when no fields arg supplied', () => {
    configureBodyRedaction(['password'])
    const body = JSON.stringify({ password: 'secret', name: 'alice' })
    const result = JSON.parse(redactJsonBody(body) as string) as { password: string; name: string }
    expect(result.password).toBe('[REDACTED]')
    expect(result.name).toBe('alice')
  })

  test('no-op when module config is empty', () => {
    const body = JSON.stringify({ password: 'secret' })
    expect(redactJsonBody(body)).toBe(body)
  })
})
