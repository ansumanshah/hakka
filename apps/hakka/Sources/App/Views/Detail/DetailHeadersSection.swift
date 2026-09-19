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
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                headerList
            }
        }
    }

    private var headerList: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(headers.keys.sorted(), id: \.self) { key in
                HStack(alignment: .top, spacing: Spacing.sm) {
                    Text(key)
                        .font(.callout.weight(.medium))
                        .frame(width: 140, alignment: .leading)
                    Text((headers[key] ?? []).joined(separator: ", "))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
    }
}
