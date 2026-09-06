import HakkaCommon
import HakkaCore
import SwiftUI

/// A readable request summary with a separate line for host and transfer metrics.
struct LiveTrafficRowView: View {
    let request: NetworkRequest
    let deviceLabel: String?
    var isSelected = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.md) {
                Text(request.method.rawValue)
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(isSelected ? Color.primary : Fmt.methodColor(request.method))
                    .frame(width: 48, alignment: .leading) // ui-token-check-ignore: aligns HTTP methods
                Text(Self.path(for: request))
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(request.status.map(String.init) ?? "–")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(isSelected ? Color.primary : Fmt.statusColor(request.status))
                    .fixedSize()
            }
            HStack(spacing: Spacing.md) {
                Text(TrafficQueryCompiler.requestHost(request))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(Fmt.duration(request.duration))
                    .monospacedDigit()
                    .fixedSize()
                Text(Fmt.bytes(request.responseBodySize))
                    .monospacedDigit()
                    .fixedSize()
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.leading, Spacing.md)
        .padding(.vertical, Spacing.md)
        .overlay(alignment: .leading) {
            if let severity = TrafficRowSeverity(status: request.status, transportError: request.error != nil) {
                RoundedRectangle(cornerRadius: Radius.xs)
                    .fill(severity == .error ? ThemeTokens.Status.error : ThemeTokens.Status.warning)
                    .frame(width: 2) // ui-token-check-ignore: severity rail
                    .padding(.vertical, Spacing.sm)
                    .accessibilityHidden(true)
            }
        }
        .help(deviceLabel.map { "\($0) · \(request.url)" } ?? request.url)
        .accessibilityElement(children: .combine)
    }

    private static func path(for request: NetworkRequest) -> String {
        guard let components = URLComponents(string: request.url) else { return request.url }
        let path = components.path.isEmpty ? "/" : components.path
        guard let query = components.query, !query.isEmpty else { return path }
        return "\(path)?\(query)"
    }
}
