import Foundation

/// Start-only traffic conditions for the managed proxy.
///
/// The Python relay applies each non-zero limit per proxied TCP connection.
/// HTTP/2 streams in one tunnel therefore share that tunnel's rate.
enum ProxyBandwidthProfile: String, CaseIterable, Codable, Identifiable, Sendable {
    case none, slow3G, fast3G, slow4G, fast4G, offline, custom

    var id: Self { self }

    var title: String {
        switch self {
        case .none: "No limit"
        case .slow3G: "Slow 3G"
        case .fast3G: "Fast 3G"
        case .slow4G: "Slow 4G"
        case .fast4G: "Fast 4G"
        case .offline: "Offline"
        case .custom: "Custom"
        }
    }

    var latencyMs: Int {
        switch self {
        case .slow3G: 400
        case .fast3G, .slow4G: 150
        case .fast4G: 75
        case .none, .offline, .custom: 0
        }
    }

    /// Values are bytes per second to avoid an ambiguous decimal/kibibit conversion at the process boundary.
    var uploadBytesPerSecond: Int? {
        switch self {
        case .slow3G: 51_200
        case .fast3G: 96_000
        case .slow4G: 384_000
        case .fast4G: 1_152_000
        case .none, .offline, .custom: nil
        }
    }

    var downloadBytesPerSecond: Int? {
        switch self {
        case .slow3G: 51_200
        case .fast3G: 204_800
        case .slow4G: 512_000
        case .fast4G: 1_152_000
        case .none, .offline, .custom: nil
        }
    }
}

struct ProxyBandwidthConfiguration: Codable, Equatable, Sendable {
    var profile: ProxyBandwidthProfile = .none
    var latencyMs: Int?
    var uploadBytesPerSecond: Int?
    var downloadBytesPerSecond: Int?

    var isOffline: Bool { profile == .offline }

    var effectiveLatencyMs: Int { profile == .custom ? latencyMs ?? 0 : profile.latencyMs }
    var effectiveUploadBytesPerSecond: Int? { profile == .custom ? uploadBytesPerSecond : profile.uploadBytesPerSecond }
    var effectiveDownloadBytesPerSecond: Int? { profile == .custom ? downloadBytesPerSecond : profile.downloadBytesPerSecond }

    var validationMessage: String? {
        guard profile == .custom else { return nil }
        if let latencyMs, !(0 ... 30_000).contains(latencyMs) { return "Latency must be between 0 and 30000 ms." }
        if let uploadBytesPerSecond, !(1 ... 1_073_741_824).contains(uploadBytesPerSecond) { return "Upload bandwidth must be between 1 and 1073741824 B/s." }
        if let downloadBytesPerSecond, !(1 ... 1_073_741_824).contains(downloadBytesPerSecond) { return "Download bandwidth must be between 1 and 1073741824 B/s." }
        if latencyMs == nil && uploadBytesPerSecond == nil && downloadBytesPerSecond == nil {
            return "Enter latency, upload bandwidth, or download bandwidth."
        }
        return nil
    }
}
