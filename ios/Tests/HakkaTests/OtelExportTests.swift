import Testing
@testable import HakkaNetwork
import HakkaCommon

@Suite struct OtelExportTests {
    @Test func exportsSpansMetricsAndLogsWithoutOtelDependency() throws {
        let request = NetworkRequest(
            id: "request-1",
            url: "https://api.example.com/users",
            method: .get,
            status: 200,
            startTime: 1_000,
            duration: 25,
            responseBodySize: 10
        )

        let payload = recordsToOtelJson(
            [
                NetworkRecord.from(request, id: "network-1"),
                FrameMetricRecord(
                    id: "frame-1",
                    timestamp: 1_100,
                    durationMs: 18,
                    refreshRateHz: 60,
                    slow: true,
                    frozen: false
                ),
                BreadcrumbRecord(
                    id: "breadcrumb-1",
                    timestamp: 1_200,
                    name: "checkout_started",
                    attributes: ["cartItems": "3"]
                )
            ],
            options: OtelExportOptions(
                serviceName: "demo-app",
                serviceVersion: "1.2.3",
                resourceAttributes: ["environment": "test"]
            )
        )

        #expect(payload.schemaVersion == recordSchemaVersion)
        #expect(payload.otelSemconvVersion == recordSemconvVersion)
        #expect(payload.resource.attributes.contains(OtelAttribute(key: "service.name", value: "demo-app")))
        #expect(payload.resource.attributes.contains(OtelAttribute(key: "service.version", value: "1.2.3")))
        #expect(payload.resource.attributes.contains(OtelAttribute(key: "otel.semconv.version", value: recordSemconvVersion)))
        #expect(payload.resource.attributes.contains(OtelAttribute(key: "environment", value: "test")))

        let span = try #require(payload.spans.first)
        #expect(span.spanId == "network-1")
        #expect(span.name == "GET https://api.example.com/users")
        #expect(span.kind == "client")
        #expect(span.startTimeUnixNano == "1000000000")
        #expect(span.endTimeUnixNano == "1025000000")
        #expect(span.status == "ok")

        #expect(payload.metricPoints.map(\.name) == ["hakka.frame.duration", "hakka.frame.refresh_rate"])

        let log = try #require(payload.logs.first)
        #expect(log.body == "checkout_started")
        #expect(log.timeUnixNano == "1200000000")
    }
}
