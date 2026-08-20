import HakkaCommon
import SwiftUI

struct DetailHeadersSection: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !record.requestHeaders.isEmpty {
                Text("Request Headers").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                headerList(record.requestHeaders)
            }
            if !record.responseHeaders.isEmpty {
                Text("Response Headers").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                headerList(record.responseHeaders)
            }
        }
    }

    private func headerList(_ headers: [String: [String]]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(headers.keys.sorted(), id: \.self) { key in
                HStack(alignment: .top, spacing: 6) {
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
