import HakkaCommon
import HakkaCore
import SwiftUI

struct DetailOverviewSection: View {
    let record: NetworkRequest
    /// nil when this record wasn't attributed to a device — a manually-sent
    /// request from the editor, or one restored from an imported session.
    let deviceLabel: String?

    private var diagnosis: RequestDiagnosis? {
        RequestDiagnoser.diagnose(record)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let diagnosis {
                DiagnosisBanner(diagnosis: diagnosis)
            }
            HStack(spacing: Spacing.md) {
                Text(record.method.rawValue)
                    .font(.headline)
                    .foregroundStyle(Fmt.methodColor(record.method))
                Text(record.status.map(String.init) ?? "–")
                    .font(.headline)
                    .foregroundStyle(Fmt.statusColor(record.status))
                Spacer()
                Text(Fmt.duration(record.duration))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(record.url)
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            if let error = record.error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            HStack(spacing: Spacing.xl) {
                metric("Request", Fmt.bytes(record.requestBodySize))
                metric("Response", Fmt.bytes(record.responseBodySize))
                if let deviceLabel {
                    metric("Device", deviceLabel)
                }
            }
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(label).font(.caption2).foregroundStyle(.tertiary)
            Text(value).font(.caption)
        }
    }
}

/// The one-line deterministic diagnosis at the top of Overview. Color and
/// icon follow `RequestDiagnosis.severity`, which mirrors the same
/// success/warning/error/info buckets `Fmt.statusColor` already uses.
private struct DiagnosisBanner: View {
    let diagnosis: RequestDiagnosis

    var body: some View {
        Label(diagnosis.text, systemImage: diagnosis.systemImage)
            .font(.callout)
            .foregroundStyle(color)
            .textSelection(.enabled)
    }

    private var color: Color {
        switch diagnosis.severity {
        case .error: ThemeTokens.Status.error
        case .warning: ThemeTokens.Status.warning
        case .info: ThemeTokens.Status.info
        }
    }
}
