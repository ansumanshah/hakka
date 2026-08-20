import HakkaCommon
import SwiftUI

/// Compact single-line row: method, status, URL, duration.
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
    }
}
