#if canImport(UIKit)
import SwiftUI

// MARK: - SelectionBar

/// Top bar shown during multi-select mode. Displays count, share, and done actions.
struct SelectionBar: View {
    let selectedCount: Int
    let onShare: () -> Void
    let onDone: () -> Void

    var body: some View {
        HStack(spacing: Theme.s10) {
            Text("\(selectedCount) selected")
                .font(.footnote)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.text)

            Spacer()

            Button(action: onShare) {
                Label("Share", systemImage: "square.and.arrow.up")
                    .font(.footnote)
                    .fontWeight(.medium)
                    .foregroundStyle(selectedCount > 0 ? Theme.info : Theme.textTertiary)
            }
            .buttonStyle(.plain)
            .disabled(selectedCount == 0)

            Button(action: onDone) {
                Text("Done")
                    .font(.footnote)
                    .fontWeight(.medium)
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, Theme.s16)
        .padding(.top, Theme.s14)
        .padding(.bottom, Theme.s6)
    }
}
#endif // canImport(UIKit)
