import AppKit
import HakkaCommon
import HakkaCore
import SwiftUI

/// Read-only analysis of one request. It makes a strict distinction between
/// captured evidence, deterministic findings, and follow-up checks.
struct RequestAnalysisSheet: View {
    @Environment(\.dismiss) private var dismiss
    let request: NetworkRequest
    @State private var copied = false

    private var report: RequestAnalysisReport {
        .make(for: request)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text("Explain Request").font(.title3.weight(.semibold))
                    Text("Captured facts and deterministic checks only")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            GroupBox("Captured evidence") {
                analysisList(report.evidence)
            }
            if let finding = report.finding {
                GroupBox("Deterministic finding") {
                    Text(finding).textSelection(.enabled)
                }
            }
            GroupBox("Next checks") {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("These checks are not proven by this capture.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    analysisList(report.nextChecks)
                }
            }
            HStack {
                Text("Report omits bodies, header values, and query values.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(copied ? "Copied" : "Copy Report", systemImage: "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(report.text, forType: .string)
                    copied = true
                }
                .disabled(copied)
            }
        }
        .padding(Spacing.xl)
        .frame(width: 580)
    }

    private func analysisList(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(items, id: \.self) { item in
                Label(item, systemImage: "circle.fill")
                    .font(.callout)
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(.primary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
