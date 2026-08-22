import Foundation
import HakkaCommon
import SwiftUI

/// Formatting shared by the traffic list, response detail, and stats footer.
/// Colors map through the generated tokens so the desktop reads as the same
/// product as the other four platforms.
enum Fmt {
    static func duration(_ ms: Int64?) -> String {
        guard let ms else { return "–" }
        return ms < 1000 ? "\(ms)ms" : String(format: "%.2fs", Double(ms) / 1000)
    }

    static func bytes(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: count, countStyle: .memory)
    }

    /// Epoch milliseconds → a local wall-clock time, e.g. "14:32:07" — the
    /// Logs panel's row timestamp. Not a full date: entries scroll by live
    /// within one session, so only the time-of-day is worth the row's space.
    static func time(_ epochMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(epochMs) / 1000)
        return date.formatted(date: .omitted, time: .standard)
    }

    static func logLevelColor(_ level: LogLevel) -> Color {
        switch level {
        case .debug: ThemeTokens.Status.pending
        case .info: ThemeTokens.Status.info
        case .warn: ThemeTokens.Status.warning
        case .error: ThemeTokens.Status.error
        }
    }

    static func statusColor(_ status: Int?) -> Color {
        guard let status else { return ThemeTokens.Status.pending }
        switch status {
        case 200..<300: return ThemeTokens.Status.success
        case 300..<400: return ThemeTokens.Status.warning
        case 400..<600: return ThemeTokens.Status.error
        default: return ThemeTokens.Status.pending
        }
    }

    static func methodColor(_ method: HttpMethod) -> Color {
        switch method {
        case .get: ThemeTokens.Method.get
        case .post: ThemeTokens.Method.post
        case .put: ThemeTokens.Method.put
        case .patch: ThemeTokens.Method.patch
        case .delete: ThemeTokens.Method.delete
        case .head, .options: ThemeTokens.Method.other
        }
    }

    /// Same mapping as `methodColor(_:)`, for a rule's raw method string
    /// (`MockRuleInput.method`/`BreakpointInput.method`) rather than a
    /// captured request's typed `HttpMethod` — `nil` means "any method" and,
    /// like an unrecognized string, gets the neutral `.other` tone.
    static func methodColor(for rawMethod: String?) -> Color {
        guard let rawMethod, let method = HttpMethod(rawValue: rawMethod.uppercased()) else {
            return ThemeTokens.Method.other
        }
        return methodColor(method)
    }

    /// "150 ms latency · 1500 kbps" — the Rules surface's throttle readout,
    /// built from `throttlePresetValues(for:)` so the numbers shown are the
    /// exact ones `ThrottleEngine.setProfile(_:)` would apply on a device,
    /// never a design mockup's illustrative placeholder.
    static func throttleReadout(_ profile: ThrottleProfile) -> String {
        guard profile != .none else { return "No throttle applied" }
        guard let preset = throttlePresetValues(for: profile) else { return "Custom profile" }
        return "\(preset.latencyMs) ms latency · \(preset.downloadKbps) kbps"
    }

    /// Which target a trace bar came from — reuses the `Timing` token trio
    /// (no dedicated runtime tokens exist in `design-tokens.json`) since
    /// those three colors are already the palette's "phase of the same
    /// journey" set, which is exactly what client → server → edge means on
    /// a trace waterfall.
    static func runtimeColor(_ runtime: RequestRuntime) -> Color {
        switch runtime {
        case .client: ThemeTokens.Timing.dns
        case .server: ThemeTokens.Timing.tls
        case .edge: ThemeTokens.Timing.ttfb
        }
    }
}
