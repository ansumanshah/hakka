import { RECORD_SEMCONV_VERSION, RECORD_SCHEMA_VERSION, type ContractRecord, recordsToOtelJson } from 'hakka-core'

describe('OTel-shaped export', () => {
  it('exports spans, metric points, and logs without OTel SDK types', () => {
    const records: ContractRecord[] = [
      {
        id: 'network-1',
        kind: 'network.request',
        schemaVersion: RECORD_SCHEMA_VERSION,
        timestamp: 1000,
        otelSemconvVersion: RECORD_SEMCONV_VERSION,
        request: {
          id: 'request-1',
          url: 'https://api.example.com/users',
          method: 'GET',
          status: 200,
          startTime: 1000,
          duration: 25,
          requestHeaders: {},
          responseHeaders: {},
          requestBodySize: 0,
          responseBodySize: 10,
          source: 'native',
        },
        attributes: {
          'http.request.method': 'GET',
          'url.full': 'https://api.example.com/users',
          'hakka.source': 'native',
          'http.response.status_code': '200',
        },
      },
      {
        id: 'frame-1',
        kind: 'metric.frame',
        schemaVersion: RECORD_SCHEMA_VERSION,
        timestamp: 1100,
        durationMs: 18,
        refreshRateHz: 60,
        slow: true,
        frozen: false,
      },
      {
        id: 'breadcrumb-1',
        kind: 'breadcrumb',
        schemaVersion: RECORD_SCHEMA_VERSION,
        timestamp: 1200,
        name: 'checkout_started',
        attributes: { cartItems: '3' },
      },
    ]

    const payload = recordsToOtelJson(records, {
      serviceName: 'demo-app',
      serviceVersion: '1.2.3',
      resourceAttributes: { environment: 'test' },
    })

    expect(payload.schemaVersion).toBe(RECORD_SCHEMA_VERSION)
    expect(payload.otelSemconvVersion).toBe(RECORD_SEMCONV_VERSION)
    expect(payload.resource.attributes).toEqual(
      expect.arrayContaining([
        { key: 'service.name', value: 'demo-app' },
        { key: 'service.version', value: '1.2.3' },
        { key: 'otel.semconv.version', value: RECORD_SEMCONV_VERSION },
        { key: 'environment', value: 'test' },
      ]),
    )
    expect(payload.spans).toHaveLength(1)
    expect(payload.spans[0]).toMatchObject({
      // Derived deterministically from the record id — a valid 16-hex OTel
      // span id, not the raw 'network-1' record id (which OTel ingestion rejects).
      spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
      name: 'GET https://api.example.com/users',
      kind: 'client',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1025000000',
      status: 'ok',
    })
    expect(payload.metricPoints.map((point) => point.name)).toEqual([
      'hakka.frame.duration',
      'hakka.frame.refresh_rate',
    ])
    expect(payload.logs).toEqual([
      expect.objectContaining({
        body: 'checkout_started',
        timeUnixNano: '1200000000',
      }),
    ])
  })
})
