import SwiftUI

/// The pause inbox's prominent affordance: a banner mounted once at the top
/// of the whole three-pane window (in `ContentView`, not per-pane), so a
/// paused device is visible from Traffic, Rules, or the request editor —
/// wherever the developer happens to be looking when a device blocks. A
/// developer whose device is frozen mid-request should not have to remember
/// to check the Rules tab's Breakpoints section; this is the thing that
/// finds them instead, in the same window they're already using.
///
/// Deliberately a banner, not a Dock badge or a system notification: Hakka
/// has no background/menu-bar presence to badge, and a breakpoint pause is
/// meant to be resolved in the next few seconds while the window has focus
/// — a notification that can be swiped away unread is the wrong affordance
/// for something a real device is actively blocked on.
struct PauseInboxBanner: View {
    @Environment(AppModel.self) private var model
    @State private var isPresented = false

    var body: some View {
        if model.pauseInbox.hasPending {
            Button {
                isPresented = true
            } label: {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "pause.circle.fill")
                    Text(bannerText)
                        .font(.callout.weight(.semibold))
                    Spacer()
                    Text("Review")
                        .font(.caption.weight(.semibold))
                }
                .padding(.horizontal, Spacing.ll)
                .padding(.vertical, Spacing.md)
                .foregroundStyle(ThemeTokens.Status.onWarm)
                .background(ThemeTokens.Status.warning)
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $isPresented) {
                PauseInboxSheet()
                    .frame(minWidth: 640, minHeight: 480)  // ui-token-check-ignore: sheet size
            }
        }
    }

    private var bannerText: String {
        let count = model.pauseInbox.entries.count
        return count == 1
            ? "1 request paused, waiting for you"
            : "\(count) requests paused, waiting for you"
    }
}
