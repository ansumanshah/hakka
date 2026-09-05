// @generated — do not edit. Synced from ios/Sources/Common/OtelExport.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

public struct OtelExportOptions: Sendable, Equatable {
    public let serviceName: String
    public let serviceVersion: String?
    public let scopeName: String
    public let scopeVersion: String?
    public let resourceAttributes: [String: String]

    public init(
        serviceName: String = "hakka-app",
        serviceVersion: String? = nil,
        scopeName: String = "hakka",
        scopeVersion: String? = nil,
        resourceAttributes: [String: String] = [:]
    ) {
        self.serviceName = serviceName
        self.serviceVersion = serviceVersion
        self.scopeName = scopeName
        self.scopeVersion = scopeVersion
        self.resourceAttributes = resourceAttributes
    }
}

public struct OtelAttribute: Sendable, Codable, Equatable {
    public let key: String
    public let value: String

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

public struct OtelResource: Sendable, Codable, Equatable {
    public let attributes: [OtelAttribute]
}

public struct OtelScope: Sendable, Codable, Equatable {
    public let name: String
    public let version: String?
}

public struct OtelSpan: Sendable, Codable, Equatable {
    public let traceId: String?
    public let spanId: String
    public let parentSpanId: String?
    public let name: String
    public let kind: String
    public let startTimeUnixNano: String
    public let endTimeUnixNano: String?
    public let attributes: [OtelAttribute]
    public let status: String?
}

public struct OtelMetricPoint: Sendable, Codable, Equatable {
    public let name: String
    public let unit: String
    public let timeUnixNano: String
    public let value: Double
    public let attributes: [OtelAttribute]
}

public struct OtelLogRecord: Sendable, Codable, Equatable {
    public let timeUnixNano: String
    public let severityText: String
    public let body: String
    public let attributes: [OtelAttribute]
}

public struct OtelJsonExport: Sendable, Codable, Equatable {
    public let schemaVersion: Int
    public let otelSemconvVersion: String
    public let resource: OtelResource
    public let scope: OtelScope
    public let spans: [OtelSpan]
    public let metricPoints: [OtelMetricPoint]
    public let logs: [OtelLogRecord]
}

public func recordsToOtelJson(_ records: [any ContractRecord], options: OtelExportOptions = OtelExportOptions()) -> OtelJsonExport {
    var spans: [OtelSpan] = []
    var metricPoints: [OtelMetricPoint] = []
    var logs: [OtelLogRecord] = []

    for record in records {
        switch record {
        case let network as NetworkRecord:
            spans.append(network.otelSpan())
        case let trace as TraceRecord:
            spans.append(trace.otelSpan())
        case let frame as FrameMetricRecord:
            metricPoints.append(contentsOf: frame.otelMetricPoints())
        case let memory as MemoryMetricRecord:
            metricPoints.append(contentsOf: memory.otelMetricPoints())
        case let cpu as CpuMetricRecord:
            metricPoints.append(contentsOf: cpu.otelMetricPoints())
        case let usage as NetworkUsageMetricRecord:
            metricPoints.append(contentsOf: usage.otelMetricPoints())
        case let jsThread as JsThreadMetricRecord:
            metricPoints.append(jsThread.otelMetricPoint())
        case let health as HealthReportRecord:
            metricPoints.append(contentsOf: health.otelMetricPoints())
            logs.append(health.otelLog())
        case let breadcrumb as BreadcrumbRecord:
            logs.append(breadcrumb.otelLog())
        default:
            continue
        }
    }

    var resourceAttributes = [
        "service.name": options.serviceName,
        "telemetry.sdk.name": "hakka",
        "hakka.schema.version": String(recordSchemaVersion),
        "otel.semconv.version": recordSemconvVersion
    ]
    if let serviceVersion = options.serviceVersion {
        resourceAttributes["service.version"] = serviceVersion
    }
    for (key, value) in options.resourceAttributes {
        resourceAttributes[key] = value
    }

    return OtelJsonExport(
        schemaVersion: recordSchemaVersion,
        otelSemconvVersion: recordSemconvVersion,
        resource: OtelResource(attributes: otelAttributes(resourceAttributes)),
        scope: OtelScope(name: options.scopeName, version: options.scopeVersion),
        spans: spans,
        metricPoints: metricPoints,
        logs: logs
    )
}

public func recordsToOtel(_ records: [any ContractRecord], options: OtelExportOptions = OtelExportOptions()) -> OtelJsonExport {
    recordsToOtelJson(records, options: options)
}

private extension NetworkRecord {
    func otelSpan() -> OtelSpan {
        let startTime = request.startTime
        let endTime = request.duration.map { startTime + $0 }
        var spanAttributes = tags
        for (key, value) in attributes {
            spanAttributes[key] = value
        }
        spanAttributes["hakka.record.id"] = id
        spanAttributes["hakka.record.kind"] = kind.rawValue
        spanAttributes["hakka.request.id"] = request.id

        return OtelSpan(
            traceId: nil,
            spanId: id,
            parentSpanId: nil,
            name: "\(request.method.rawValue) \(request.url)",
            kind: "client",
            startTimeUnixNano: unixNanos(fromMillis: startTime),
            endTimeUnixNano: endTime.map { unixNanos(fromMillis: $0) },
            attributes: otelAttributes(spanAttributes),
            status: request.error != nil || (request.status ?? 0) >= 400 ? "error" : "ok"
        )
    }
}

private extension TraceRecord {
    func otelSpan() -> OtelSpan {
        var spanAttributes = tags
        for (key, value) in attributes {
            spanAttributes[key] = value
        }
        spanAttributes["hakka.record.id"] = id
        spanAttributes["hakka.record.kind"] = kind.rawValue

        return OtelSpan(
            traceId: traceId,
            spanId: spanId,
            parentSpanId: parentSpanId,
            name: name,
            kind: "internal",
            startTimeUnixNano: unixNanos(fromMillis: startTime),
            endTimeUnixNano: endTime.map { unixNanos(fromMillis: $0) },
            attributes: otelAttributes(spanAttributes),
            status: status
        )
    }
}

private extension FrameMetricRecord {
    func otelMetricPoints() -> [OtelMetricPoint] {
        let attributes = otelAttributes(merging(tags, ["hakka.record.id": id, "slow": String(slow), "frozen": String(frozen)]))
        var points = [
            metricPoint("hakka.frame.duration", unit: "ms", timestamp: timestamp, value: durationMs, attributes: attributes)
        ]
        if let refreshRateHz {
            points.append(metricPoint("hakka.frame.refresh_rate", unit: "Hz", timestamp: timestamp, value: refreshRateHz, attributes: attributes))
        }
        return points
    }
}

private extension MemoryMetricRecord {
    func otelMetricPoints() -> [OtelMetricPoint] {
        let attributes = otelAttributes(merging(tags, ["hakka.record.id": id]))
        return [
            pssBytes.map { metricPoint("hakka.memory.pss", unit: "By", timestamp: timestamp, value: Double($0), attributes: attributes) },
            heapUsedBytes.map { metricPoint("hakka.memory.heap.used", unit: "By", timestamp: timestamp, value: Double($0), attributes: attributes) },
            heapMaxBytes.map { metricPoint("hakka.memory.heap.max", unit: "By", timestamp: timestamp, value: Double($0), attributes: attributes) }
        ].compactMap { $0 }
    }
}

private extension CpuMetricRecord {
    func otelMetricPoints() -> [OtelMetricPoint] {
        guard let processCpuPercent else { return [] }
        return [
            metricPoint(
                "hakka.cpu.process.percent",
                unit: "%",
                timestamp: timestamp,
                value: processCpuPercent,
                attributes: otelAttributes(merging(tags, ["hakka.record.id": id]))
            )
        ]
    }
}

private extension NetworkUsageMetricRecord {
    func otelMetricPoints() -> [OtelMetricPoint] {
        let attributes = otelAttributes(merging(tags, ["hakka.record.id": id]))
        return [
            rxBytes.map { metricPoint("hakka.network.rx", unit: "By", timestamp: timestamp, value: Double($0), attributes: attributes) },
            txBytes.map { metricPoint("hakka.network.tx", unit: "By", timestamp: timestamp, value: Double($0), attributes: attributes) }
        ].compactMap { $0 }
    }
}

private extension JsThreadMetricRecord {
    func otelMetricPoint() -> OtelMetricPoint {
        metricPoint(
            "hakka.js_thread.event_loop_delay",
            unit: "ms",
            timestamp: timestamp,
            value: eventLoopDelayMs,
            attributes: otelAttributes(merging(tags, ["hakka.record.id": id]))
        )
    }
}

private extension HealthReportRecord {
    func otelMetricPoints() -> [OtelMetricPoint] {
        let attributes = otelAttributes(merging(tags, ["hakka.record.id": id]))
        return [
            metricPoint("hakka.health.requests", unit: "1", timestamp: timestamp, value: Double(totalRequests), attributes: attributes),
            metricPoint("hakka.health.error_rate", unit: "1", timestamp: timestamp, value: errorRate, attributes: attributes),
            slowFrameRate.map { metricPoint("hakka.health.slow_frame_rate", unit: "1", timestamp: timestamp, value: $0, attributes: attributes) },
            frozenFrameCount.map { metricPoint("hakka.health.frozen_frames", unit: "1", timestamp: timestamp, value: Double($0), attributes: attributes) }
        ].compactMap { $0 }
    }

    func otelLog() -> OtelLogRecord {
        OtelLogRecord(
            timeUnixNano: unixNanos(fromMillis: timestamp),
            severityText: errorRate > 0 ? "WARN" : "INFO",
            body: summary ?? "health.report",
            attributes: otelAttributes(
                merging(
                    tags,
                    [
                    "hakka.record.id": id,
                    "hakka.record.kind": kind.rawValue,
                    "hakka.health.window_start": String(windowStart),
                    "hakka.health.window_end": String(windowEnd)
                    ]
                )
            )
        )
    }
}

private extension BreadcrumbRecord {
    func otelLog() -> OtelLogRecord {
        var logAttributes = tags
        for (key, value) in attributes {
            logAttributes[key] = value
        }
        logAttributes["hakka.record.id"] = id
        logAttributes["hakka.record.kind"] = kind.rawValue

        return OtelLogRecord(
            timeUnixNano: unixNanos(fromMillis: timestamp),
            severityText: "INFO",
            body: name,
            attributes: otelAttributes(logAttributes)
        )
    }
}

private func metricPoint(
    _ name: String,
    unit: String,
    timestamp: Int64,
    value: Double,
    attributes: [OtelAttribute]
) -> OtelMetricPoint {
    OtelMetricPoint(
        name: name,
        unit: unit,
        timeUnixNano: unixNanos(fromMillis: timestamp),
        value: value,
        attributes: attributes
    )
}

private func otelAttributes(_ attributes: [String: String]) -> [OtelAttribute] {
    attributes
        .sorted { $0.key < $1.key }
        .map { OtelAttribute(key: $0.key, value: $0.value) }
}

private func merging(_ base: [String: String], _ additional: [String: String]) -> [String: String] {
    var merged = base
    for (key, value) in additional {
        merged[key] = value
    }
    return merged
}

private func unixNanos(fromMillis milliseconds: Int64) -> String {
    "\(milliseconds)000000"
}
