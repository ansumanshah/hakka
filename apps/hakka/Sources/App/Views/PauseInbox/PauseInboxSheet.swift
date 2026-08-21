import SwiftUI

/// The pause inbox review sheet — every outstanding pause across every
/// connected device, opened from `PauseInboxBanner`. `PauseRowView` is what
/// makes concurrent pauses distinguishable (device label + row content);
/// this sheet just lists them and auto-dismisses once none remain.
struct PauseInboxSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(model.pauseInbox.entries) { pause in
                PauseRowView(pause: pause)
            }
            .navigationTitle("Paused Requests")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let note = model.pauseInbox.deliveryNote {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(8)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .onChange(of: model.pauseInbox.hasPending) { _, hasPending in
            if !hasPending { dismiss() }
        }
    }
}
