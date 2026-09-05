#if canImport(UIKit)
import SwiftUI
import HakkaCommon

// MARK: - ThrottleView

/// Network throttle panel — mirrors ThrottleTab (web).
///
/// Shows a profile picker (none / fast-3g / slow-3g / edge / offline) and
/// the resolved latency + bandwidth for the selected profile.
/// Changes take effect immediately via `ThrottleEngine.shared.setProfile(_:)`.
@MainActor
struct ThrottleView: View {

    // MARK: - State

    /// Hidden when embedded under the Rules segmented switch, which already
    /// shows the section title — avoids a duplicate header there.
    var showToolbar: Bool = true

    @State private var selectedProfile: ThrottleProfile = .none
    @State private var config: ThrottleConfig = ThrottleEngine.shared.config
    @State private var unsubscribe: (() -> Void)?

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            if showToolbar {
                toolbar
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.s12) {
                    profileSection.hakkaGroupedCard()
                    statusSection.hakkaGroupedCard()
                    infoSection.hakkaGroupedCard()
                }
                .padding(.horizontal, HakkaMetrics.Layout.gutter)
                .padding(.top, Theme.s12)
                .padding(.bottom, Theme.s20)
            }
            .scrollIndicators(.hidden)
        }
        .hakkaPageCanvas()
        .onAppear {
            syncFromEngine()
            unsubscribe = ThrottleEngine.shared.subscribe { [self] in
                Task { @MainActor in syncFromEngine() }
            }
        }
        .onDisappear {
            unsubscribe?()
            unsubscribe = nil
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "speedometer")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            Text("Throttle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            if selectedProfile != .none {
                Circle()
                    .fill(profileColor(selectedProfile))
                    .frame(width: 8, height: 8)  // ui-token-check-ignore: chart bar or plot-area geometry
            }
        }
        .hakkaInspectorToolbar()
    }

    // MARK: - Profile section

    private var profileSection: some View {
        VStack(alignment: .leading, spacing: Theme.s10) {
            VStack(alignment: .leading, spacing: Theme.s2) {
                Text("Network profile")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                Text("Simulate network conditions for all intercepted requests")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: Theme.s6) {
                ForEach(ThrottleProfile.allCases, id: \.rawValue) { profile in
                    profileRow(profile)
                }
            }
        }
    }

    private func profileRow(_ profile: ThrottleProfile) -> some View {
        let isActive = selectedProfile == profile
        return Button {
            selectedProfile = profile
            ThrottleEngine.shared.setProfile(profile)
            Haptics.light()
        } label: {
            HStack(spacing: Theme.s12) {
                ZStack {
                    Circle()
                        .stroke(isActive ? profileColor(profile) : Theme.border, lineWidth: 1.5)
                        .frame(width: HakkaMetrics.ControlHeight.badge, height: HakkaMetrics.ControlHeight.badge)
                    if isActive {
                        Circle()
                            .fill(profileColor(profile))
                            .frame(width: 10, height: 10)  // ui-token-check-ignore: chart bar or plot-area geometry
                    }
                }
                .animation(.spring(response: 0.2, dampingFraction: 0.9), value: isActive)

                // Label + spec
                VStack(alignment: .leading, spacing: HakkaMetrics.Spacing.xxs) {
                    Text(profileLabel(profile))
                        .font(.caption.weight(isActive ? .semibold : .regular))
                        .foregroundStyle(isActive ? Theme.text : Theme.textSecondary)
                    Text(profileSpec(profile))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.textTertiary)
                }

                Spacer()

                if profile == .offline {
                    Text("DROP")
                        .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, Theme.s6)
                        .padding(.vertical, HakkaMetrics.Spacing.xxs)
                        .background(Theme.error)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                }
            }
            .padding(.horizontal, Theme.s12)
            .padding(.vertical, Theme.s10)
            .background(isActive ? profileColor(profile).opacity(0.08) : Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusM)
                    .stroke(isActive ? profileColor(profile).opacity(0.4) : Theme.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.15), value: isActive)
        .accessibilityLabel("Select \(profileLabel(profile)) profile")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    // MARK: - Status section

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            Text("ACTIVE SETTINGS")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.textTertiary)
                .kerning(0.5)

            if config.profile == .none {
                Text("No throttling — requests pass through at full speed.")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            } else if config.profile == .offline {
                HStack(spacing: Theme.s8) {
                    Image(systemName: "wifi.slash")
                        .foregroundStyle(Theme.error)
                        .font(.caption)
                    Text("All requests will fail with a network-not-connected error.")
                        .font(.caption)
                        .foregroundStyle(Theme.error)
                }
            } else {
                HStack(spacing: Theme.s20) {
                    statCell(label: "Latency", value: "\(config.latencyMs) ms")
                    statCell(label: "Download", value: "\(config.downloadKbps) kbps")
                }
            }
        }
    }

    private func statCell(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: HakkaMetrics.Spacing.xxs) {
            Text(label.uppercased())
                .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
                .kerning(0.5)
            Text(value)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(Theme.text)
        }
    }

    // MARK: - Info section

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            Text("HOW IT WORKS")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.textTertiary)
                .kerning(0.5)

            Text("Throttle adds latency before the request is sent, then paces the response body at the chosen bandwidth. Offline immediately fails the request. Throttling is in-process — no proxy or certificate required. Real timing metrics in the request detail reflect the throttled durations.")
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .italic()
        }
    }

    // MARK: - Helpers

    private func syncFromEngine() {
        config = ThrottleEngine.shared.config
        selectedProfile = config.profile
    }

    private func profileLabel(_ profile: ThrottleProfile) -> String {
        switch profile {
        case .none:    return "No throttle"
        case .fast3g:  return "Fast 3G"
        case .slow3g:  return "Slow 3G"
        case .edge:    return "Edge"
        case .offline: return "Offline"
        case .custom:  return "Custom"
        }
    }

    private func profileSpec(_ profile: ThrottleProfile) -> String {
        switch profile {
        case .none:    return "Unlimited"
        case .fast3g:  return "150 ms · 1500 kbps"
        case .slow3g:  return "400 ms · 400 kbps"
        case .edge:    return "250 ms · 240 kbps"
        case .offline: return "Request dropped immediately"
        case .custom:  return "\(config.latencyMs) ms · \(config.downloadKbps) kbps"
        }
    }

    private func profileColor(_ profile: ThrottleProfile) -> Color {
        switch profile {
        case .none:    return Theme.info
        case .fast3g:  return Theme.success
        case .slow3g:  return Theme.warning
        case .edge:    return Color.orange
        case .offline: return Theme.error
        case .custom:  return Theme.info
        }
    }
}

#if DEBUG
#Preview("Throttle — none") { ThrottleView() }
#Preview("Throttle — slow-3g") {
    ThrottleEngine.shared.setProfile(.slow3g)
    return ThrottleView()
}
#Preview("Throttle — offline") {
    ThrottleEngine.shared.setProfile(.offline)
    return ThrottleView()
}
#endif
#endif // canImport(UIKit)
