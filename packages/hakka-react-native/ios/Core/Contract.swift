// @generated — do not edit. Synced from ios/Sources/Common/Contract.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

public let recordSchemaVersion = 1
public let recordSemconvVersion = "1.40.0"

@frozen public enum RecordKind: String, Sendable, Codable {
    case networkRequest = "network.request"
    case frameMetric = "metric.frame"
    case memoryMetric = "metric.memory"
    case cpuMetric = "metric.cpu"
    case networkUsageMetric = "metric.network_usage"
    case jsThreadMetric = "metric.js_thread"
    case breadcrumb
    case trace
    case healthReport = "health.report"
}

public protocol ContractRecord: Sendable {
    var id: String { get }
    var kind: RecordKind { get }
    var schemaVersion: Int { get }
    var timestamp: Int64 { get }
    var sessionId: String? { get }
    var tags: [String: String] { get }
}

public struct NetworkRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let otelSemconvVersion: String
    public let request: NetworkRequest
    public let attributes: [String: String]

    public init(
        id: String = "network-\(UUID().uuidString)",
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        request: NetworkRequest,
        attributes: [String: String] = [:],
        schemaVersion: Int = recordSchemaVersion,
        otelSemconvVersion: String = recordSemconvVersion
    ) {
        self.id = id
        self.kind = .networkRequest
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.request = request
        self.attributes = attributes
        self.otelSemconvVersion = otelSemconvVersion
    }

    public static func from(
        _ request: NetworkRequest,
        id: String = "network-\(UUID().uuidString)",
        sessionId: String? = nil,
        tags: [String: String] = [:],
        timestamp: Int64? = nil
    ) -> NetworkRecord {
        NetworkRecord(
            id: id,
            timestamp: timestamp ?? request.startTime,
            sessionId: sessionId,
            tags: tags,
            request: request,
            attributes: Self.attributes(for: request)
        )
    }

    private static func attributes(for request: NetworkRequest) -> [String: String] {
        var attributes: [String: String] = [
            "http.request.method": request.method.rawValue,
            "url.full": request.url,
            "hakka.source": request.source.hakkaWireValue
        ]
        if let status = request.status {
            attributes["http.response.status_code"] = String(status)
        }
        if let error = request.error {
            attributes["error.type"] = error
        }
        if let networkProtocol = request.networkProtocol {
            attributes["network.protocol.name"] = networkProtocol
        }
        if let duration = request.duration {
            attributes["hakka.duration_ms"] = String(duration)
        }
        if let operationName = request.graphqlOperationName {
            attributes["graphql.operation.name"] = operationName
        }
        if let correlationId = request.correlationId {
            attributes["hakka.correlation_id"] = correlationId
        }
        return attributes
    }
}

public struct NetworkMetricsSummary: Sendable, Codable, Equatable {
    public let totalRequests: Int
    public let completedRequests: Int
    public let successCount: Int
    public let errorCount: Int
    public let averageResponseTime: Double
    public let successRate: Double
    public let errorRate: Double
    public let p95LatencyMs: Int64?
    public let totalDataTransferred: Int64

    public init(
        totalRequests: Int,
        completedRequests: Int,
        successCount: Int,
        errorCount: Int,
        averageResponseTime: Double,
        successRate: Double,
        errorRate: Double,
        p95LatencyMs: Int64?,
        totalDataTransferred: Int64
    ) {
        self.totalRequests = totalRequests
        self.completedRequests = completedRequests
        self.successCount = successCount
        self.errorCount = errorCount
        self.averageResponseTime = averageResponseTime
        self.successRate = successRate
        self.errorRate = errorRate
        self.p95LatencyMs = p95LatencyMs
        self.totalDataTransferred = totalDataTransferred
    }
}

public struct FrameMetricRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let durationMs: Double
    public let refreshRateHz: Double?
    public let slow: Bool
    public let frozen: Bool

    public init(
        id: String = "frame-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        durationMs: Double,
        refreshRateHz: Double? = nil,
        slow: Bool,
        frozen: Bool
    ) {
        self.id = id
        self.kind = .frameMetric
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.durationMs = durationMs
        self.refreshRateHz = refreshRateHz
        self.slow = slow
        self.frozen = frozen
    }
}

public struct MemoryMetricRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let pssBytes: Int64?
    public let heapUsedBytes: Int64?
    public let heapMaxBytes: Int64?

    public init(
        id: String = "memory-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        pssBytes: Int64? = nil,
        heapUsedBytes: Int64? = nil,
        heapMaxBytes: Int64? = nil
    ) {
        self.id = id
        self.kind = .memoryMetric
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.pssBytes = pssBytes
        self.heapUsedBytes = heapUsedBytes
        self.heapMaxBytes = heapMaxBytes
    }
}

public struct CpuMetricRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let processCpuPercent: Double?

    public init(
        id: String = "cpu-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        processCpuPercent: Double? = nil
    ) {
        self.id = id
        self.kind = .cpuMetric
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.processCpuPercent = processCpuPercent
    }
}

public struct NetworkUsageMetricRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let rxBytes: Int64?
    public let txBytes: Int64?

    public init(
        id: String = "network-usage-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        rxBytes: Int64? = nil,
        txBytes: Int64? = nil
    ) {
        self.id = id
        self.kind = .networkUsageMetric
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.rxBytes = rxBytes
        self.txBytes = txBytes
    }
}

public struct JsThreadMetricRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let eventLoopDelayMs: Double

    public init(
        id: String = "js-thread-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        eventLoopDelayMs: Double
    ) {
        self.id = id
        self.kind = .jsThreadMetric
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.eventLoopDelayMs = eventLoopDelayMs
    }
}

public struct BreadcrumbRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let name: String
    public let attributes: [String: String]

    public init(
        id: String = "breadcrumb-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        name: String,
        attributes: [String: String] = [:]
    ) {
        self.id = id
        self.kind = .breadcrumb
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.name = name
        self.attributes = attributes
    }
}

public struct TraceRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let name: String
    public let traceId: String
    public let spanId: String
    public let parentSpanId: String?
    public let startTime: Int64
    public let endTime: Int64?
    public let attributes: [String: String]
    public let status: String?

    public init(
        id: String = "trace-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        name: String,
        traceId: String,
        spanId: String,
        parentSpanId: String? = nil,
        startTime: Int64,
        endTime: Int64? = nil,
        attributes: [String: String] = [:],
        status: String? = nil
    ) {
        self.id = id
        self.kind = .trace
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.name = name
        self.traceId = traceId
        self.spanId = spanId
        self.parentSpanId = parentSpanId
        self.startTime = startTime
        self.endTime = endTime
        self.attributes = attributes
        self.status = status
    }
}

public struct HealthReportRecord: ContractRecord, Sendable, Codable, Equatable {
    public let id: String
    public let kind: RecordKind
    public let schemaVersion: Int
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let windowStart: Int64
    public let windowEnd: Int64
    public let totalRequests: Int
    public let errorRate: Double
    public let slowFrameRate: Double?
    public let frozenFrameCount: Int?
    public let summary: String?

    public init(
        id: String = "health-\(UUID().uuidString)",
        schemaVersion: Int = recordSchemaVersion,
        timestamp: Int64,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        windowStart: Int64,
        windowEnd: Int64,
        totalRequests: Int,
        errorRate: Double,
        slowFrameRate: Double? = nil,
        frozenFrameCount: Int? = nil,
        summary: String? = nil
    ) {
        self.id = id
        self.kind = .healthReport
        self.schemaVersion = schemaVersion
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.windowStart = windowStart
        self.windowEnd = windowEnd
        self.totalRequests = totalRequests
        self.errorRate = errorRate
        self.slowFrameRate = slowFrameRate
        self.frozenFrameCount = frozenFrameCount
        self.summary = summary
    }
}

public let HakkaSchemaVersion = recordSchemaVersion
public let HakkaSemconvVersion = recordSemconvVersion

