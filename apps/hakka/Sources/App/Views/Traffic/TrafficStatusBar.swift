import HakkaCore
import SwiftUI

/// Visible traffic totals from the existing capture accumulator.
struct TrafficStatusBar: View {
    let stats: TrafficStats
    let visibleCount: Int

    var body: some View {
        HStack(spacing: Spacing.md) {
            value("\(visibleCount) of \(stats.count)", label: "visible")
            value("\(stats.errorCount)", label: "errors", tone: stats.errorCount > 0 ? ThemeTokens.Status.error : nil)
            value(Fmt.bytes(stats.totalBytes), label: "received")
            Spacer(minLength: 0)
        }
        .font(.caption2.monospacedDigit())
        .foregroundStyle(.secondary)
        .padding(.horizontal, Layout.gutter)
        .frame(height: ControlHeight.chip)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Traffic summary: \(visibleCount) visible of \(stats.count), \(stats.errorCount) errors, \(Fmt.bytes(stats.totalBytes)) received")
    }

    private func value(_ value: String, label: String, tone: Color? = nil) -> some View {
        HStack(spacing: Spacing.xxs) {
            Text(value).foregroundStyle(tone ?? .secondary)
            Text(label)
        }
    }

}
