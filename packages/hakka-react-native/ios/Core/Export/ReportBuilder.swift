// @generated — do not edit. Synced from ios/Sources/Common/Export/ReportBuilder.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

#if os(iOS) || os(tvOS)
import UIKit
#endif

/// Builds a combined report from captured network requests.
/// Produces HAR, human-readable text, and compact JSON suitable for Sentry breadcrumbs.
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

    /// Build a report from the given requests.
    /// If `deviceInfo` is nil, auto-populates from the current device/app.
    public static func build(requests: [NetworkRequest], deviceInfo: DeviceInfo? = nil) -> Report {
        let info = deviceInfo ?? currentDeviceInfo()
        let har = HarExporter.export(requests) ?? "[]"
        let text = TextExporter.export(requests)
        let json = buildCompactJSON(requests)

        let startTimes = requests.map(\.startTime)
        let endTimes = requests.compactMap { req -> Int64? in
            guard let d = req.duration else { return nil }
            return req.startTime + d
        }

        return Report(
            har: har,
            text: text,
            json: json,
            deviceInfo: info,
            requestCount: requests.count,
            timeRangeStart: startTimes.min(),
            timeRangeEnd: endTimes.max() ?? startTimes.max()
        )
    }

    // MARK: - Compact JSON

    private static func buildCompactJSON(_ requests: [NetworkRequest]) -> String {
        let entries: [[String: Any]] = requests.map { req in
            var entry: [String: Any] = [
                "method": req.method.rawValue,
                "url": shortenURL(req.url),
            ]
            if let status = req.status { entry["status"] = status }
            if let duration = req.duration { entry["duration"] = duration }
            if let error = req.error { entry["error"] = error }
            return entry
        }
        guard let data = try? JSONSerialization.data(withJSONObject: entries, options: [.sortedKeys]) else {
            return "[]"
        }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    /// Strip scheme and host, keep path for compact breadcrumbs.
    private static func shortenURL(_ urlString: String) -> String {
        guard let url = URL(string: urlString) else { return urlString }
        var path = url.path
        if path.isEmpty { path = "/" }
        if let query = url.query { path += "?\(query)" }
        return path
    }

    // MARK: - Device Info

    private static func currentDeviceInfo() -> DeviceInfo {
        let bundle = Bundle.main
        let version = bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let bundleId = bundle.bundleIdentifier ?? "unknown"

        #if os(iOS) || os(tvOS)
        return MainActor.assumeIsolated {
            let device = UIDevice.current
            return DeviceInfo(
                osVersion: "\(device.systemName) \(device.systemVersion)",
                deviceModel: device.model,
                appVersion: version,
                appBundleId: bundleId
            )
        }
        #else
        return genericDeviceInfo(appVersion: version, appBundleId: bundleId)
        #endif
    }

    /// Fallback device info for platforms without `UIDevice` (macOS, watchOS).
    /// `UIDevice` is unavailable on watchOS even though `UIKit` itself imports
    /// there, so this path is not exclusive to macOS despite the historical name.
    #if !(os(iOS) || os(tvOS))
    private static func genericDeviceInfo(appVersion: String, appBundleId: String) -> DeviceInfo {
        let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        #if os(watchOS)
        let platformName = "watchOS"
        let deviceModel = "Apple Watch"
        #else
        let platformName = "macOS"
        let deviceModel = "Mac"
        #endif
        return DeviceInfo(
            osVersion: "\(platformName) \(osVersion)",
            deviceModel: deviceModel,
            appVersion: appVersion,
            appBundleId: appBundleId
        )
    }
    #endif
}
