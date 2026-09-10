import HakkaCore
import SwiftUI

/// Protocol facts from a JSON-RPC 2.0 exchange. Payloads remain in the normal
/// body tabs; Overview only identifies calls, notifications, results, and
/// error codes.
struct JSONRPCSummarySectionView: View {
    let summary: JSONRPCSummary

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("JSON-RPC 2.0")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let request = summary.request {
                messageBody("Request", value: request)
            }
            if let response = summary.response {
                messageBody("Response", value: response)
            }
        }
    }

    private func messageBody(_ title: String, value: JSONRPCSummary.Body) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(value.isBatch ? "\(title) batch (\(value.messageCount))" : title)
                .font(.caption.weight(.medium))
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ForEach(Array(value.messages.enumerated()), id: \.offset) { index, message in
                    messageFacts(message, index: value.isBatch ? index + 1 : nil)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func messageFacts(_ message: JSONRPCSummary.Message, index: Int?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            if let index {
                Text("Message \(index)")
                    .font(.caption.weight(.medium))
            }
            if let method = message.method {
                row("Method", method)
                row("Notification", message.isNotification ? "Yes" : "No")
            }
            if let id = message.id {
                row("ID", id.displayValue)
            }
            if message.hasResult {
                row("Result", "Present")
            }
            if let errorCode = message.errorCode {
                row("Error code", errorCode.formatted())
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Text(label)
                .font(.caption.weight(.medium))
                .frame(width: 140, alignment: .leading)
            Text(value)
                .lineLimit(2).truncationMode(.middle)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
