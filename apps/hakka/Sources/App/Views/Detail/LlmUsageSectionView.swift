import HakkaCore
import SwiftUI

/// Token usage for an LLM response, rendered as rows in the Overview tab
/// when usage parses out of the response body. Tokens only — no cost math.
struct LlmUsageSectionView: View {
    let usage: LlmUsage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Usage")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                if let model = usage.model {
                    row("Model", model)
                }
                if let promptTokens = usage.promptTokens {
                    row("Prompt tokens", promptTokens.formatted())
                }
                if let completionTokens = usage.completionTokens {
                    row("Completion tokens", completionTokens.formatted())
                }
                if let totalTokens = usage.totalTokens {
                    row("Total tokens", totalTokens.formatted())
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(label)
                .font(.caption.weight(.medium))
                .frame(width: 140, alignment: .leading)
            Text(value)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
