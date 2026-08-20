import SwiftUI

/// Generic placeholder for a pane with nothing to show yet — "no request
/// selected", "send a request to see the response", "select a captured row".
struct EmptyStateView: View {
    let systemImage: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
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
    }
}
