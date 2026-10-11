import Foundation

/// Encode an opt-in `performance` bridge frame using the canonical v1 records.
/// Timestamp values stay in Unix milliseconds, byte counts stay in bytes, and
/// durations stay in milliseconds. Batches exceeding 100 records, invalid
/// metrics, and batches with no supported metrics return nil.
public func encodePerformanceBridgeFrame(_ records: [any ContractRecord]) -> String? {
    guard !records.isEmpty, records.count <= 100 else { return nil }
    var payload: [PerformanceBridgeRecord] = []
    for record in records {
        guard let metric = PerformanceBridgeRecord(record) else { continue }
        guard record.schemaVersion == recordSchemaVersion,
              !record.id.isEmpty, record.id.utf16.count <= 512,
              record.timestamp >= 0, record.timestamp <= 9_007_199_254_740_991,
              metric.hasValidValues,
              let encodedRecord = try? JSONEncoder().encode(metric),
              encodedRecord.count <= 8 * 1024 else { return nil }
        payload.append(metric)
    }
    guard !payload.isEmpty,
          let data = try? JSONEncoder().encode(BridgeWireMessage(type: "performance", payload: payload)),
          data.count <= 256 * 1024 else {
        return nil
    }
    return String(data: data, encoding: .utf8)
}

/// Only concrete canonical metric types may reach the performance wire.
private enum PerformanceBridgeRecord: Encodable {
    case frame(FrameMetricRecord)
    case memory(MemoryMetricRecord)
    case cpu(CpuMetricRecord)
    case networkUsage(NetworkUsageMetricRecord)
    case jsThread(JsThreadMetricRecord)

    init?(_ record: any ContractRecord) {
        switch record {
        case let value as FrameMetricRecord: self = .frame(value)
        case let value as MemoryMetricRecord: self = .memory(value)
        case let value as CpuMetricRecord: self = .cpu(value)
        case let value as NetworkUsageMetricRecord: self = .networkUsage(value)
        case let value as JsThreadMetricRecord: self = .jsThread(value)
        default: return nil
        }
    }

    var hasValidValues: Bool {
        switch self {
        case .frame(let value):
            return value.kind == .frameMetric && valid(value.durationMs) && valid(value.refreshRateHz)
        case .memory(let value):
            return value.kind == .memoryMetric && valid(value.pssBytes)
                && valid(value.heapUsedBytes) && valid(value.heapMaxBytes)
        case .cpu(let value):
            return value.kind == .cpuMetric && valid(value.processCpuPercent)
        case .networkUsage(let value):
            return value.kind == .networkUsageMetric && valid(value.rxBytes) && valid(value.txBytes)
        case .jsThread(let value):
            return value.kind == .jsThreadMetric && valid(value.eventLoopDelayMs)
        }
    }

    func encode(to encoder: any Encoder) throws {
        switch self {
        case .frame(let value): try value.encode(to: encoder)
        case .memory(let value): try value.encode(to: encoder)
        case .cpu(let value): try value.encode(to: encoder)
        case .networkUsage(let value): try value.encode(to: encoder)
        case .jsThread(let value): try value.encode(to: encoder)
        }
    }

    private func valid(_ value: Double?) -> Bool {
        value.map { $0.isFinite && $0 >= 0 } ?? true
    }

    private func valid(_ value: Int64?) -> Bool {
        value.map { $0 >= 0 && $0 <= 9_007_199_254_740_991 } ?? true
    }
}
