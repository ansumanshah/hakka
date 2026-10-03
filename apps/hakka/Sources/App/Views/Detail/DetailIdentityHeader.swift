import HakkaCommon
import HakkaCore
import SwiftUI

/// Persistent request identity separates the URL from response metrics so both
/// remain readable in a narrow inspector.
struct DetailIdentityHeader: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Text(record.method.rawValue)
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(Fmt.methodColor(record.method))
                    .accessibilityLabel("Method \(record.method.rawValue)")
                Text(record.status.map(String.init) ?? "Pending")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Fmt.statusColor(record.status))
                    .accessibilityLabel(record.status.map { "Status \($0)" } ?? "Status pending")
                Spacer(minLength: Spacing.sm)
                Text(Fmt.duration(record.duration))
                    .accessibilityLabel("Duration \(Fmt.duration(record.duration))")
                Text(Fmt.bytes(record.responseBodySize))
                    .accessibilityLabel("Response size \(Fmt.bytes(record.responseBodySize))")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(ThemeTokens.Palette.textSecondary)
            Text(record.url)
                .font(.callout.monospaced())
                .foregroundStyle(ThemeTokens.Palette.text)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .help(record.url)
        }
        .padding(.vertical, Spacing.lg)
        .frame(minHeight: ControlHeight.bar, alignment: .leading)
    }
}
