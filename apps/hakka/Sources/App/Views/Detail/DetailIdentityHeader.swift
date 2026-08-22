import HakkaCommon
import HakkaCore
import SwiftUI

/// Method + status + duration + path, hoisted above the tab strip so it
/// stays visible on every detail tab — Request, Response, and Timing all
/// used to lose the record's identity the moment you left Overview, which
/// meant scrolling back up just to re-check which request you were looking
/// at. Mirrors the design's `detail_header`: identity (method, status) reads
/// as a headline, the path is secondary and second.
struct DetailIdentityHeader: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Text(record.method.rawValue)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Fmt.methodColor(record.method))
                Text(record.status.map(String.init) ?? "–")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Fmt.statusColor(record.status))
                Spacer()
                Text(Fmt.duration(record.duration))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Text(record.url)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.sm)
        .background(.bar)
    }
}
