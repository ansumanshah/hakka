import { describe, expect, it } from 'bun:test'

import { RECORD_SCHEMA_VERSION, RECORD_SEMCONV_VERSION, networkRequestToRecord } from '../contract'
import { exportHarString } from '../har'
import { recordsToOtelJson } from '../otel'
import type { NetworkRequest } from '../types'

const GET_200: NetworkRequest = {
  id: 'req-get-200',
  url: 'https://api.example.com/v1/users?page=1',
  method: 'GET',
  startTime: 1_700_000_000_000,
  status: 200,
  duration: 120,
  requestHeaders: { accept: 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: '{"users":[]}',
  contentType: 'application/json',
}

const POST_404: NetworkRequest = {
  id: 'req-post-404',
  url: 'https://api.example.com/v1/items',
  method: 'POST',
  startTime: 1_700_000_001_000,
  status: 404,
  duration: 55,
  requestHeaders: { 'content-type': 'application/json' },
  requestBody: '{"name":"widget"}',
  responseBody: '{"error":"not found"}',
  contentType: 'application/json',
}

describe('HAR export roundtrip', () => {
  it('produces valid JSON with HAR 1.2 version', () => {
    const json = exportHarString([GET_200])
    const parsed = JSON.parse(json)
    expect(parsed.log.version).toBe('1.2')
  })

  it('GET 200 — request url and method survive roundtrip', () => {
    const json = exportHarString([GET_200])
    const parsed = JSON.parse(json)
    const entry = parsed.log.entries[0]
    expect(entry.request.url).toBe('https://api.example.com/v1/users?page=1')
    expect(entry.request.method).toBe('GET')
  })

  it('GET 200 — response status matches input', () => {
    const json = exportHarString([GET_200])
    const parsed = JSON.parse(json)
    expect(parsed.log.entries[0].response.status).toBe(200)
  })

  it('POST 404 — request url and method survive roundtrip', () => {
    const json = exportHarString([POST_404])
    const parsed = JSON.parse(json)
    const entry = parsed.log.entries[0]
    expect(entry.request.url).toBe('https://api.example.com/v1/items')
    expect(entry.request.method).toBe('POST')
  })

  it('POST 404 — response status matches input', () => {
    const json = exportHarString([POST_404])
    const parsed = JSON.parse(json)
    expect(parsed.log.entries[0].response.status).toBe(404)
  })

  it('multiple entries — log.entries length matches input array', () => {
    const json = exportHarString([GET_200, POST_404])
    const parsed = JSON.parse(json)
    expect(parsed.log.entries).toHaveLength(2)
  })

  it('POST — request body is included as postData.text', () => {
    const json = exportHarString([POST_404])
    const parsed = JSON.parse(json)
    expect(parsed.log.entries[0].request.postData?.text).toBe('{"name":"widget"}')
  })
})

describe('OTel export roundtrip', () => {
  it('GET 200 — spans array contains one span with correct name', () => {
    const record = networkRequestToRecord(GET_200)
    const exported = recordsToOtelJson([record])
    expect(exported.spans).toHaveLength(1)
    expect(exported.spans[0].name).toBe('GET https://api.example.com/v1/users?page=1')
  })

  it('GET 200 — span has a non-empty spanId', () => {
    const record = networkRequestToRecord(GET_200)
    const exported = recordsToOtelJson([record])
    expect(exported.spans[0].spanId).toBeTruthy()
  })

  it('GET 200 — span has a startTimeUnixNano string', () => {
    const record = networkRequestToRecord(GET_200)
    const exported = recordsToOtelJson([record])
    const nano = exported.spans[0].startTimeUnixNano
    expect(typeof nano).toBe('string')
    expect(nano.length).toBeGreaterThan(0)
  })

  it('export carries correct schemaVersion', () => {
    const record = networkRequestToRecord(GET_200)
    const exported = recordsToOtelJson([record])
    expect(exported.schemaVersion).toBe(RECORD_SCHEMA_VERSION)
  })

  it('export carries correct otelSemconvVersion', () => {
    const record = networkRequestToRecord(GET_200)
    const exported = recordsToOtelJson([record])
    expect(exported.otelSemconvVersion).toBe(RECORD_SEMCONV_VERSION)
  })

  it('two records produce two spans', () => {
    const r1 = networkRequestToRecord(GET_200)
    const r2 = networkRequestToRecord(POST_404)
    const exported = recordsToOtelJson([r1, r2])
    expect(exported.spans).toHaveLength(2)
  })
})
