import HakkaCommon
import HakkaCore
import SwiftUI

/// Method + status + path + response metrics, hoisted above the tab strip so it
/// stays visible on every detail tab — Request, Response, and Timing all
/// used to lose the record's identity the moment you left Overview, which
/// meant scrolling back up just to re-check which request you were looking at.
struct DetailIdentityHeader: View {
    let record: NetworkRequest

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            Text(record.method.rawValue)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Fmt.methodColor(record.method))
                .accessibilityLabel("Method \(record.method.rawValue)")
            Text(record.status.map(String.init) ?? "–")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Fmt.statusColor(record.status))
                .accessibilityLabel(record.status.map { "Status \($0)" } ?? "Status pending")
            Text(record.url)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .help(record.url)
            HStack(spacing: Spacing.md) {
                Text(Fmt.duration(record.duration))
                    .accessibilityLabel("Duration \(Fmt.duration(record.duration))")
                Text(Fmt.bytes(record.responseBodySize))
                    .accessibilityLabel("Response size \(Fmt.bytes(record.responseBodySize))")
            }
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: true, vertical: false)
        }
        .frame(height: ControlHeight.bar)
    }
}
