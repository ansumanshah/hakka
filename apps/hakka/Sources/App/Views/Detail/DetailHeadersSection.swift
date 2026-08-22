import HakkaCommon
import SwiftUI

/// One side's headers (request or response) as a sorted name/value table —
/// each detail tab renders its own headers above its body, so the section
/// takes exactly one header map.
struct DetailHeadersSection: View {
    let title: String
    let headers: [String: [String]]

    init(_ title: String, headers: [String: [String]]) {
        self.title = title
        self.headers = headers
    }

    var body: some View {
        if !headers.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                headerList
            }
        }
    }

    private var headerList: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            ForEach(headers.keys.sorted(), id: \.self) { key in
                HStack(alignment: .top, spacing: Spacing.sm) {
                    Text(key)
                        .font(.caption.weight(.medium))
                        .frame(width: 140, alignment: .leading)
                    Text((headers[key] ?? []).joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
    }
}
