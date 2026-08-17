import Foundation
import os
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - HakkaOSLogBridge

/// Small `Logger`/`os_log` wrapper: the app calls it instead of `os.Logger`
/// directly, and every call both (a) forwards to the real OS unified-logging
/// system via `os.Logger` (so Console.app / `log stream` still see it) and
/// (b) forwards to ``HakkaInterceptor/logStore`` via
/// ``HakkaInterceptor/log(_:_:category:metadata:)`` so it shows up in the
/// Logs inspector panel.
///
/// This is deliberately NOT a global `os_log` swizzle — swizzling the system
/// logging facility is fragile across OS versions and would capture logs from
/// every framework in the process, not just the host app. Call sites opt in
/// explicitly:
/// ```swift
/// HakkaOSLogBridge.shared.info("User logged in", category: "auth")
/// HakkaOSLogBridge.shared.error("Request failed", category: "network", metadata: ["url": url])
/// ```
///
/// Never throws — logging must never crash the host app.
public final class HakkaOSLogBridge: Sendable {
    public static let shared = HakkaOSLogBridge()

    private let subsystem: String

    public init(subsystem: String = Bundle.main.bundleIdentifier ?? "com.noodleapps.hakka") {
        self.subsystem = subsystem
    }

    /// Forwards a message to both `os.Logger` and the structured ``HakkaLogStore``.
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
