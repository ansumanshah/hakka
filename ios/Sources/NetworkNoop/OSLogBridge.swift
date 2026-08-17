import Foundation
import os
import HakkaCommon

// MARK: - HakkaOSLogBridge (noop)

/// No-op-build twin of `HakkaNetwork`'s `HakkaOSLogBridge`. Still forwards to
/// `os.Logger` (Console.app / `log stream` keep working) and to the noop
/// ``HakkaInterceptor/logStore`` so structured logging works even when
/// network capture is compiled out. See the real implementation in
/// `Sources/Network/OSLogBridge.swift` for full documentation.
public final class HakkaOSLogBridge: Sendable {
    public static let shared = HakkaOSLogBridge()

    private let subsystem: String

    public init(subsystem: String = Bundle.main.bundleIdentifier ?? "com.noodleapps.hakka") {
        self.subsystem = subsystem
    }

    public func log(_ level: LogLevel, _ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        osLogger(category: category).log(level: level.osLogType, "\(message, privacy: .public)")
        HakkaInterceptor.shared.log(level, message, category: category, metadata: metadata)
    }

    public func debug(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.debug, message, category: category, metadata: metadata)
    }

    public func info(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.info, message, category: category, metadata: metadata)
    }

    public func warn(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.warn, message, category: category, metadata: metadata)
    }

    public func error(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.error, message, category: category, metadata: metadata)
    }

    private func osLogger(category: String?) -> Logger {
        Logger(subsystem: subsystem, category: category ?? "general")
    }
}

private extension LogLevel {
    var osLogType: OSLogType {
        switch self {
        case .debug: return .debug
        case .info:  return .info
        case .warn:  return .default
        case .error: return .error
        }
    }
}
