import HakkaCommon
import HakkaCore
import SwiftUI

/// The promote-to-mock confirmation sheet — opened from `DetailActionBar`'s
/// Mock button instead of installing on live devices with no review step
/// (gap-audit-2026-08-22.md item 2; design source `.claude/design/gen.py`,
/// artboard 7). Lets the match `CapturedMockConverter` derived be reviewed
/// and edited before anything goes on the wire.
///
/// Plain material for now, per this sheet's brief — the Liquid Glass system
/// (item 1) is a separate, still-in-flight piece of work.
struct PromoteMockSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let request: NetworkRequest
    @State private var draft: PromoteMockDraft?

    init(request: NetworkRequest) {
        self.request = request
        _draft = State(initialValue: PromoteMockDraft.prefill(from: request))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if let binding = Binding($draft) {
                content(binding)
            } else {
                unavailable
            }
        }
        .frame(width: 560)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("Mock this response")
                .font(.system(size: FontSize.xl, weight: .semibold))
            Text("This is the exact response your app already got back. Save it once and every matching request gets it again, instantly, with nothing touching the network.")
                .font(.system(size: FontSize.sm))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.xl)
    }

    private func content(_ draft: Binding<PromoteMockDraft>) -> some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            PromoteMockCapturedEchoView(
                method: draft.wrappedValue.capturedMethod,
                path: draft.wrappedValue.capturedPath,
                status: draft.wrappedValue.capturedStatus,
                durationMs: draft.wrappedValue.capturedDurationMs,
                capturedAt: draft.wrappedValue.capturedAt
            )
            PromoteMockMatchCard(draft: draft)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.bottom, Spacing.lg)
        .safeAreaInset(edge: .bottom) {
            footer(draft.wrappedValue)
        }
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Label(
                CapturedMockConverter.PromotionError.incompleteCapture(url: request.url, underlying: request.error).localizedDescription,
                systemImage: "exclamationmark.triangle"
            )
            .font(.system(size: FontSize.sm))
            .foregroundStyle(ThemeTokens.Status.error)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.bottom, Spacing.lg)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button("Close") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(Spacing.lg)
        }
    }

    private func footer(_ draft: PromoteMockDraft) -> some View {
        HStack(spacing: Spacing.md) {
            let connected = model.traffic.devices.filter(\.isConnected).count
            Label("\(connected) device\(connected == 1 ? "" : "s") connected", systemImage: "antenna.radiowaves.left.and.right")
                .font(.system(size: FontSize.sm))
                .foregroundStyle(connected > 0 ? ThemeTokens.Status.success : .secondary)
                .accessibilityLabel("\(connected) device\(connected == 1 ? "" : "s") connected")
            Spacer()
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
            Button("Install mock") { install(draft) }
                .keyboardShortcut(.defaultAction)
                .disabled(!draft.isValid)
        }
        .padding(Spacing.lg)
    }

    /// Fires the same fire-and-forget promotion `AppModel` already exposed —
    /// the sheet dismisses immediately, and `DetailActionBar`'s transient
    /// `mockNote` (unchanged) carries the delivered-device-count or failure
    /// feedback afterward, same as the one-click path did.
    private func install(_ draft: PromoteMockDraft) {
        model.promoteCapturedToMock(request, pattern: draft.trimmedPattern, method: draft.trimmedMethod)
        dismiss()
    }
}
