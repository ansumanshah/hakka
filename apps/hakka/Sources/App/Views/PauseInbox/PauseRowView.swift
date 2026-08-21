import HakkaCommon
import HakkaCore
import SwiftUI

/// One row in the pause inbox. `pauseId` and `device` together are what make
/// two simultaneous pauses distinguishable: `pauseId` is unique per pause
/// instance even when the same breakpoint rule fires twice on one device,
/// and `device` separates pauses arriving from different devices at the
/// same instant — both are shown, never just one.
struct PauseRowView: View {
    @Environment(AppModel.self) private var model
    let pause: PendingPause

    var body: some View {
        NavigationLink {
            PauseEditorView(pause: pause)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(pause.phase == .response ? "RESPONSE" : "REQUEST")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(pause.phase == .response ? ThemeTokens.Timing.ttfb : ThemeTokens.Timing.dns)
                    Text(pause.device)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(pause.arrivedAt, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text("\(pause.request.method) \(pause.request.url)")
                    .font(.callout.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .swipeActions(edge: .trailing) {
            Button("Abort", role: .destructive) { model.pauseInbox.abort(pause) }
            Button("Resume") { model.pauseInbox.resume(pause) }
                .tint(ThemeTokens.Status.success)
        }
    }
}
