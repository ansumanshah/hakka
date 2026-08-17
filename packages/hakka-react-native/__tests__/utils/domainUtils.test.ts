import { extractHost } from 'hakka-core'

describe('extractHost', () => {
  it('extracts host with port', () => {
    expect(extractHost('http://localhost:3000/api')).toBe('localhost')
  })
})
