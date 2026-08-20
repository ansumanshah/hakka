import HakkaCommon
import SwiftUI

struct DetailOverviewSection: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
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
            HStack(spacing: 16) {
                metric("Request", Fmt.bytes(record.requestBodySize))
                metric("Response", Fmt.bytes(record.responseBodySize))
                if let networkProtocol = record.networkProtocol {
                    metric("Protocol", networkProtocol)
                }
            }
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.tertiary)
            Text(value).font(.caption)
        }
    }
}
