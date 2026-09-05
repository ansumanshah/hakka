// @generated — do not edit. Synced from ios/Sources/UI/Detail/InlineJSONView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI

// MARK: - InlineJSONView

/// Collapsible inline JSON tree — renders directly in the scroll view
/// instead of opening a sheet.
struct InlineJSONView: View {
    let rootNode: JSONNode
    @State private var collapsed: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            JSONNodeView(node: rootNode, depth: 0, collapsed: $collapsed)
        }
        .padding(.horizontal, Theme.s10)
        .padding(.vertical, Theme.s8)
        .background(Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusM)
                .stroke(Theme.border.opacity(0.3), lineWidth: 0.5)
        )
    }
}
#endif // canImport(UIKit)
