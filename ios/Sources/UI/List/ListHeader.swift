#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork

// MARK: - ListHeader

/// Compact sheet header for the inspector.
struct ListHeader: View {
    let requests: [NetworkRequest]
    let isPaused: Bool
    let onSelect: () -> Void
    let onShare: () -> Void
    let onClear: () -> Void
    let onClose: () -> Void
    let onTogglePause: () -> Void
    let onSettings: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                GlassEffectContainer(spacing: Theme.s10) {
                    headerContent
                }
            } else {
                headerContent
            }
        }
        .hakkaInspectorToolbar()
    }

    private var headerContent: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Theme.s8) {
                    title
                    HStack(spacing: Theme.s8) {
                        controls
                        Spacer(minLength: 0)
                    }
                    StatsBar(requests: requests)
                }
            } else {
                HStack(alignment: .center, spacing: Theme.s10) {
                    VStack(alignment: .leading, spacing: Theme.s2) {
                        title
                        StatsBar(requests: requests)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    controls
                }
            }
        }
    }

    private var title: some View {
        HStack(spacing: Theme.s6) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: Theme.iconM, weight: .semibold))
                .accessibilityHidden(true)
            Text("Network")
                .font(.headline.weight(.semibold))
        }
        .foregroundStyle(Theme.text)
    }

    private var controls: some View {
            HStack(spacing: Theme.s12) {
                // Session controls: grouped on one surface so they read as a
                // single unit, distinct from the standalone gear/Close actions.
                // Dashboard moved off this row entirely — it's the Stats tab now.
                HStack(spacing: Theme.s2) {
                    pauseButton
                    actionsMenu
                }
                .padding(.horizontal, Theme.s2)
                .background(Theme.controlTint, in: RoundedRectangle(cornerRadius: Theme.radiusM, style: .continuous))

                headerButton("gearshape", label: "Settings", action: onSettings)
                headerButton("xmark", label: "Close", action: onClose)
            }
            .fixedSize(horizontal: true, vertical: false)
    }

    private var pauseButton: some View {
        Button(action: onTogglePause) {
            Image(systemName: isPaused ? "play.fill" : "pause.fill")
                .font(.system(size: Theme.iconM, weight: .semibold))
                .foregroundStyle(isPaused ? Theme.warning : Theme.textSecondary)
                .frame(width: HakkaMetrics.ControlHeight.icon, height: HakkaMetrics.ControlHeight.icon)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hakkaIconTarget()
        .accessibilityLabel(isPaused ? "Resume capture" : "Pause capture")
    }

    private var actionsMenu: some View {
        Menu {
            Button(action: onSelect) {
                Label("Select Requests", systemImage: "checklist")
            }
            Button(action: onShare) {
                Label("Share Report", systemImage: "square.and.arrow.up")
            }
            .disabled(requests.isEmpty)
            Button(role: .destructive, action: onClear) {
                Label("Clear Requests", systemImage: "trash")
            }
            .disabled(requests.isEmpty)
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: Theme.iconM, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: HakkaMetrics.ControlHeight.icon, height: HakkaMetrics.ControlHeight.icon)
                .contentShape(Circle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hakkaIconTarget()
        .accessibilityLabel("More actions")
    }

    private func headerButton(_ icon: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        headerButton(icon, label: icon, disabled: disabled, action: action)
    }

    private func headerButton(
        _ icon: String,
        label: String,
        disabled: Bool = false,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: Theme.iconM, weight: .semibold))
                .foregroundStyle(disabled ? Theme.textTertiary : destructive ? Theme.error : Theme.textSecondary)
                .frame(width: HakkaMetrics.ControlHeight.icon, height: HakkaMetrics.ControlHeight.icon)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hakkaIconTarget()
        .disabled(disabled)
        .accessibilityLabel(label)
    }
}

#if DEBUG
#Preview("ListHeader — With Requests") {
    ListHeader(
        requests: PreviewData.batch,
        isPaused: false,
        onSelect: {},
        onShare: {},
        onClear: {},
        onClose: {},
        onTogglePause: {},
        onSettings: {}
    )
    .background(Theme.bg)
}
#Preview("ListHeader — Empty") {
    ListHeader(
        requests: [],
        isPaused: false,
        onSelect: {},
        onShare: {},
        onClear: {},
        onClose: {},
        onTogglePause: {},
        onSettings: {}
    )
    .background(Theme.bg)
}
#Preview("ListHeader — Paused") {
    ListHeader(
        requests: PreviewData.batch,
        isPaused: true,
        onSelect: {},
        onShare: {},
        onClear: {},
        onClose: {},
        onTogglePause: {},
        onSettings: {}
    )
    .background(Theme.bg)
}
#endif
#endif // canImport(UIKit)
