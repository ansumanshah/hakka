import Foundation

// MARK: - HarExporter

/// No-op HAR exporter. Always returns `nil`.
public enum HarExporter {
    /// Always returns `nil`.
    public static func export(_ requests: [NetworkRequest], prettyPrint: Bool = false) -> String? {
        nil
    }
}

// MARK: - CurlExporter

/// No-op cURL exporter. Always returns an empty string.
public enum CurlExporter {
    /// Always returns an empty string.
    public static func export(_ request: NetworkRequest) -> String {
        ""
    }
}

// MARK: - TextExporter

/// No-op text exporter. Always returns an empty string.
public enum TextExporter {
    /// Always returns an empty string.
    public static func export(_ request: NetworkRequest) -> String {
        ""
    }

    /// Always returns an empty string.
    public static func export(_ requests: [NetworkRequest]) -> String {
        ""
    }
}

// MARK: - ReportBuilder

/// No-op report builder. Returns an empty report.
public enum ReportBuilder {
    /// A complete network report bundle.
    public struct Report: Sendable {
        public let har: String
        public let text: String
        /// Compact JSON array for Sentry breadcrumbs (no bodies/headers).
        public let json: String
        public let deviceInfo: DeviceInfo
        public let requestCount: Int
        public let timeRangeStart: Int64?
        public let timeRangeEnd: Int64?
    }

    /// Basic device and app metadata.
    public struct DeviceInfo: Sendable, Codable {
        public let osVersion: String
        public let deviceModel: String
        public let appVersion: String
        public let appBundleId: String

        public init(osVersion: String, deviceModel: String, appVersion: String, appBundleId: String) {
            self.osVersion = osVersion
            self.deviceModel = deviceModel
            self.appVersion = appVersion
            self.appBundleId = appBundleId
        }
    }

    /// Always returns an empty report.
    public static func build(requests: [NetworkRequest], deviceInfo: DeviceInfo? = nil) -> Report {
        let info = deviceInfo ?? DeviceInfo(
            osVersion: "unknown",
            deviceModel: "unknown",
            appVersion: "unknown",
            appBundleId: "unknown"
        )
        return Report(
            har: "",
            text: "",
            json: "[]",
            deviceInfo: info,
            requestCount: 0,
            timeRangeStart: nil,
            timeRangeEnd: nil
        )
    }
}
