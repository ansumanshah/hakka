import SwiftUI

/// Generic placeholder for a pane with nothing to show yet — "no request
/// selected", "send a request to see the response", "select a captured row".
/// This is exactly Artboard 8's "sparse detail pane" chrome surface, so the
/// chrome-material background lives here once rather than at each of its
/// ~20 call sites across the detail pane, center pane, and sheets.
struct EmptyStateView: View {
    let systemImage: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: systemImage)
                .font(.system(size: 40))  // ui-token-check-ignore: empty-state illustration
                .foregroundStyle(.tertiary)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            if let message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .chromeMaterial(.panel)
    }
}
