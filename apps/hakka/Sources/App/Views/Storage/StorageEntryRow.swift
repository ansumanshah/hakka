import AppKit
import SwiftUI

/// One key/value pair inside a store's disclosure group. Split out of
/// `StoragePanelView.swift` to hold the 200-line budget. `.contextMenu` is
/// the copy affordance — the repo's primary secondary-action gesture for a
/// row, per `swiftui-patterns.md` ("`.contextMenu` is the primary secondary-
/// action affordance"), not a hover toolbar icon.
struct StorageEntryRow: View {
    let key: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Text(key)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(minWidth: 120, alignment: .leading)
            Text(value)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(Rectangle())
        .contextMenu {
            Button("Copy Value") { copy(value) }
            Button("Copy Key") { copy(key) }
            Button("Copy Key and Value") { copy("\(key): \(value)") }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(key): \(value)")
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
