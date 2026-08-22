import HakkaCommon
import HakkaCore
import SwiftUI

/// Single-line row: device dot, method, path, host, status, duration, size.
/// The left-edge stripe encodes severity at a glance — chili for failures,
/// turmeric for 4xx — matching the traffic grammar on the other four
/// platforms. Mirrors `TrafficColumn` (see its doc comment), the field set
/// `LiveTrafficTableView` draws as resizable columns; this is the same data,
/// laid out as one dense scan line instead.
///
/// Host gets its own fixed column rather than living inside the (middle-
/// truncated) path — middle truncation gives no guarantee the host segment
/// survives, so a request against a long path could silently lose the one
/// field that says which API it hit.
struct LiveTrafficRowView: View {
    let request: NetworkRequest
    /// nil for a request the bridge never attributed (e.g. one restored
    /// from an imported session) — the dot is simply omitted, never shown
    /// as a guess.
    let deviceLabel: String?

    private static let hostWidth: CGFloat = 130
    private static let statusWidth: CGFloat = 40
    private static let durationWidth: CGFloat = 56
    private static let sizeWidth: CGFloat = 56

    var body: some View {
        HStack(spacing: Spacing.md) {
            if let deviceLabel {
                deviceDot(for: deviceLabel)
            }
            Text(request.method.rawValue)
                .font(.caption.weight(.bold))
                .foregroundStyle(Fmt.methodColor(request.method))
                .frame(width: 44, alignment: .leading)
            Text(Self.path(for: request))
                .font(.callout)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(TrafficQueryCompiler.requestHost(request))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: Self.hostWidth, alignment: .leading)
            Text(request.status.map(String.init) ?? "–")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Fmt.statusColor(request.status))
                .frame(width: Self.statusWidth, alignment: .trailing)
            Text(Fmt.duration(request.duration))
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: Self.durationWidth, alignment: .trailing)
            Text(Fmt.bytes(request.responseBodySize))
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: Self.sizeWidth, alignment: .trailing)
        }
        // Vertical, not a fixed height: at larger Dynamic Type sizes the row
        // grows with its tallest text instead of clipping it.
        .padding(.vertical, Spacing.xs)
        .overlay(alignment: .leading) {
            if let severity {
                Rectangle()
                    .fill(color(for: severity))
                    .frame(width: 2)
            }
        }
    }

    /// A small filled-or-outline mark, not a hue: device identity must never
    /// collide with the method/status colour vocabulary, so both states
    /// render in the same neutral tone and differ only in fill. Which of the
    /// two a device gets is a stable hash of its label — with more than two
    /// connected devices this is a deliberate approximation (two marks, not
    /// a mark per device); a real per-device colour is a token-roadmap item,
    /// not something to invent ad hoc here.
    private func deviceDot(for label: String) -> some View {
        let filled = Self.isPrimary(label)
        return Group {
            if filled {
                Circle().fill(Color.secondary)
            } else {
                Circle().strokeBorder(Color.secondary, lineWidth: 1.2)
            }
        }
        .frame(width: 6, height: 6)  // ui-token-check-ignore: identity mark, not a control
        .accessibilityLabel("Device: \(label)")
    }

    private static func isPrimary(_ label: String) -> Bool {
        abs(label.hashValue) % 2 == 0
    }

    private var severity: TrafficRowSeverity? {
        TrafficRowSeverity(status: request.status, transportError: request.error != nil)
    }

    private func color(for severity: TrafficRowSeverity) -> Color {
        switch severity {
        case .error: ThemeTokens.Status.error
        case .warning: ThemeTokens.Status.warning
        }
    }

    /// The URL's path (plus query, when present) — `host` is its own column
    /// now, so path should not repeat it. Falls back to the raw URL when it
    /// doesn't parse, same defensiveness as `TrafficQueryCompiler.requestHost`.
    private static func path(for request: NetworkRequest) -> String {
        guard let components = URLComponents(string: request.url) else { return request.url }
        let path = components.path.isEmpty ? "/" : components.path
        guard let query = components.query, !query.isEmpty else { return path }
        return "\(path)?\(query)"
    }
}
