import HakkaCommon
import SwiftUI

struct DetailBodySection: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let body = record.requestBody, !body.isEmpty {
                Text("Request Body").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                bodyText(body)
            }
            if let body = record.responseBody, !body.isEmpty {
                Text("Response Body").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                bodyText(body)
            }
        }
    }

    private func bodyText(_ text: String) -> some View {
        Text(text)
            .font(.system(.caption, design: .monospaced))
            .textSelection(.enabled)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}
