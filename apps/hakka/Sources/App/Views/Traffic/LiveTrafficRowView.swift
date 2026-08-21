import HakkaCommon
import HakkaCore
import SwiftUI

/// Compact single-line row: method, status, URL, duration. The left-edge
/// stripe encodes severity at a glance — chili for failures, turmeric for
/// 4xx — matching the traffic grammar on the other four platforms.
struct LiveTrafficRowView: View {
    let request: NetworkRequest

    var body: some View {
        HStack(spacing: 8) {
            Text(request.method.rawValue)
                .font(.caption.weight(.bold))
                .foregroundStyle(Fmt.methodColor(request.method))
                .frame(width: 44, alignment: .leading)
            Text(request.status.map(String.init) ?? "–")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Fmt.statusColor(request.status))
                .frame(width: 32, alignment: .leading)
            Text(request.url)
                .font(.callout)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            Text(Fmt.duration(request.duration))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .overlay(alignment: .leading) {
            if let severity {
                Rectangle()
                    .fill(color(for: severity))
                    .frame(width: 2)
            }
        }
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
}
