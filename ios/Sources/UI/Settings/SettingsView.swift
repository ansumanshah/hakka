#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork

// MARK: - SettingsView

/// Inspector settings panel — mirrors SettingsTab (web) and SettingsPanel (RN).
///
/// Exposes:
/// - Max records (ring buffer capacity, 10–5000)
/// - Retention / maxAge (age-based drop; 0 = forever)
/// - Redact body fields (comma-separated JSON body field names)
/// - Desktop bridge: bridgeURL text field + connect/disconnect toggle
/// - Trace injection toggle
/// - Environment: app/device/network facts (merged from the old Info tab)
///
/// Changes are applied immediately via `HakkaInterceptor.shared.updateConfig`.
struct SettingsView: View {

    // Settings is reached via the header gear icon (present on every tab)
    // rather than a bottom-bar slot, and is always presented as a sheet —
    // so it always needs its own dismiss affordance.
    @Environment(\.dismiss) private var dismiss

    // MARK: - Constants

    private static let defaultBridgeURL = "ws://localhost:8989"
    private static let retentionOptions: [(label: String, seconds: TimeInterval)] = [
        ("Forever",  0),
        ("1 hour",   3_600),
        ("6 hours",  21_600),
        ("1 day",    86_400),
        ("1 week",   604_800),
    ]

    // MARK: - State

    @State private var maxRecords: Int = 500
    @State private var maxRecordsText: String = "500"
    @State private var maxAge: TimeInterval = 0
    @State private var redactBodyText: String = ""
    @State private var bridgeEnabled: Bool = false
    @State private var bridgeURLText: String = SettingsView.defaultBridgeURL
    @State private var bridgeStatus: BridgeConnectionState = .disconnected
    @State private var traceEnabled: Bool = false
    // Hosts found on the LAN via `HakkaInterceptor.discoverBridge()`/auto-discovery.
    // Populated only in the "many hosts" case — exactly one host auto-connects instead
    // (see `BridgeDiscoverySelection`), so this list never shows a single entry.
    @State private var discoveredHosts: [DiscoveredBridgeHost] = []
    @State private var isDiscovering: Bool = false

    // Active bridge client managed by this view (in addition to the one inside
    // Interceptor) — a separate client lets the UI toggle connect/disconnect
    // independently.
    @State private var bridgeClient: HakkaBridgeClient?

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    maxRecordsRow
                    Divider().overlay(Theme.border.opacity(0.5))
                    retentionRow
                    Divider().overlay(Theme.border.opacity(0.5))
                    redactBodySection
                    Divider().overlay(Theme.border.opacity(0.5))
                    bridgeSection
                    Divider().overlay(Theme.border.opacity(0.5))
                    traceRow
                    Divider().overlay(Theme.border.opacity(0.5))
                    EnvironmentSection()
                }
                .padding(.horizontal, Theme.s16)
                .padding(.bottom, Theme.s20)
            }
            .scrollIndicators(.hidden)
        }
        .background(Theme.bg)
        .onAppear { loadFromInterceptor() }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: Theme.s8) {
            Image(systemName: "gearshape")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            Text("Settings")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.text)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .hakkaInspectorToolbar()
    }

    // MARK: - Max Records Row

    private var maxRecordsRow: some View {
        HStack(spacing: Theme.s12) {
            labelStack(
                "Max records",
                hint: "Ring buffer capacity (10–5000)"
            )
            TextField("500", text: $maxRecordsText)
                .font(.caption.monospacedDigit())
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.trailing)
                .keyboardType(.numberPad)
                .frame(width: 60)
                .padding(.horizontal, Theme.s8)
                .padding(.vertical, Theme.s6)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                .onSubmit { applyMaxRecords() }
        }
        .padding(.vertical, Theme.s12)
    }

    // MARK: - Retention Row

    private var retentionRow: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            labelStack("Retention", hint: "Drop captures older than this age")
            HStack(spacing: Theme.s6) {
                ForEach(Self.retentionOptions, id: \.seconds) { option in
                    retentionChip(option)
                }
            }
        }
        .padding(.vertical, Theme.s12)
    }

    /// Same outlined chip component as the Network filter bar (DESIGN.md: one
    /// chip grammar everywhere) — not a second filled-solid segmented skin.
    private func retentionChip(_ option: (label: String, seconds: TimeInterval)) -> some View {
        HakkaChip(label: option.label, isActive: maxAge == option.seconds, tone: Theme.accent, mono: false) {
            maxAge = option.seconds
            applyMaxAge()
            Haptics.light()
        }
    }

    // MARK: - Redact Body Section

    private var redactBodySection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            labelStack(
                "Redact body fields",
                hint: "Mask these JSON keys in captured bodies (comma-separated, case-insensitive)"
            )
            HStack(spacing: Theme.s6) {
                TextField("password, token, ssn", text: $redactBodyText)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.text)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, Theme.s8)
                    .padding(.vertical, Theme.s6)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                    .onSubmit { applyRedactBody() }

                applyButton { applyRedactBody() }
            }
        }
        .padding(.vertical, Theme.s12)
    }

    // MARK: - Bridge Section

    private var bridgeSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            HStack(spacing: Theme.s12) {
                labelStack(
                    "Connect to desktop",
                    hint: "Stream captures to the Hakka desktop app"
                )
                toggle($bridgeEnabled) { v in
                    applyBridgeConnect(v)
                }
            }

            Text(bridgeStatusLabel)
                .font(.caption2)
                .foregroundStyle(bridgeStatusColor)

            HStack(spacing: Theme.s6) {
                TextField(Self.defaultBridgeURL, text: $bridgeURLText)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.text)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .padding(.horizontal, Theme.s8)
                    .padding(.vertical, Theme.s6)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                    .onSubmit { applyBridgeURL() }

                applyButton { applyBridgeURL() }
            }

            discoverOnLanRow
        }
        .padding(.vertical, Theme.s12)
    }

    // MARK: - Discover on LAN

    /// Zero-config discovery: browses for `_hakka._tcp` on the LAN (no address to type).
    /// Exactly one host found auto-connects via the interceptor itself; this row only ever
    /// needs to show a picker for the "many hosts" case — see `BridgeDiscoverySelection`.
    private var discoverOnLanRow: some View {
        VStack(alignment: .leading, spacing: Theme.s6) {
            Button {
                startLanDiscovery()
                Haptics.light()
            } label: {
                HStack(spacing: Theme.s6) {
                    if isDiscovering {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "wifi")
                    }
                    Text(isDiscovering ? "Searching…" : "Discover on LAN")
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .disabled(isDiscovering)

            if !discoveredHosts.isEmpty {
                VStack(alignment: .leading, spacing: Theme.s4) {
                    Text("Found \(discoveredHosts.count) hubs on the LAN — pick one:")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                    ForEach(discoveredHosts, id: \.hostname) { host in
                        Button {
                            connect(to: host)
                            Haptics.light()
                        } label: {
                            Text("\(host.hostname):\(host.port)")
                                .font(.caption2.monospaced())
                                .foregroundStyle(Theme.text)
                                .padding(.horizontal, Theme.s8)
                                .padding(.vertical, Theme.s4)
                                .background(Theme.surface)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Trace Row

    private var traceRow: some View {
        HStack(spacing: Theme.s12) {
            labelStack(
                "Trace injection",
                hint: "Inject x-hakka-trace header for cross-layer correlation"
            )
            toggle($traceEnabled) { v in
                HakkaInterceptor.shared.updateConfig { $0.replacing(traceEnabled: v) }
            }
        }
        .padding(.vertical, Theme.s12)
    }

    // MARK: - Reusable Components

    private func labelStack(_ title: String, hint: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.s2) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)
            Text(hint)
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func toggle(_ binding: Binding<Bool>, onChange: @escaping (Bool) -> Void) -> some View {
        Button {
            let next = !binding.wrappedValue
            binding.wrappedValue = next
            Haptics.light()
            onChange(next)
        } label: {
            ZStack(alignment: binding.wrappedValue ? .trailing : .leading) {
                Capsule()
                    .fill(binding.wrappedValue ? Theme.accent : Theme.border)
                    .frame(width: HakkaMetrics.ControlHeight.nav, height: HakkaMetrics.ControlHeight.chip)
                Circle()
                    .fill(.white)
                    .frame(width: HakkaMetrics.ControlHeight.badge, height: HakkaMetrics.ControlHeight.badge)
                    .padding(.horizontal, HakkaMetrics.Spacing.xxs)
                    .shadow(color: .black.opacity(0.15), radius: 2, y: 1)
            }
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.25, dampingFraction: 0.85), value: binding.wrappedValue)
    }

    private func applyButton(action: @escaping () -> Void) -> some View {
        Button {
            action()
            Haptics.light()
        } label: {
            Text("Apply")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, Theme.s8)
                .padding(.vertical, Theme.s6)
                .background(Theme.accent)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Bridge status helpers

    private var bridgeStatusLabel: String {
        switch bridgeStatus {
        case .disconnected: return "Disconnected"
        case .connecting(let url): return "Connecting to \(url)…"
        case .connected(let url): return "Connected to \(url)"
        case .error(let msg): return "Error: \(msg)"
        }
    }

    private var bridgeStatusColor: Color {
        switch bridgeStatus {
        case .connected:    return Theme.success
        case .connecting:   return Theme.warning
        case .error:        return Theme.error
        case .disconnected: return Theme.textTertiary
        }
    }

    // MARK: - Apply helpers

    private func loadFromInterceptor() {
        let config = HakkaInterceptor.shared.config
        maxRecords = config.maxRequests
        maxRecordsText = String(config.maxRequests)
        maxAge = config.maxAge ?? 0
        redactBodyText = config.sensitiveBodyFields.sorted().joined(separator: ", ")
        traceEnabled = config.traceEnabled
        if let url = config.bridgeURL {
            bridgeURLText = url.absoluteString
            bridgeEnabled = true
            bridgeStatus = .connecting(url: url.absoluteString)
        }
        discoveredHosts = HakkaInterceptor.shared.discoveredBridgeHosts
        HakkaInterceptor.shared.onBridgeHostsDiscovered = { selection in
            Task { @MainActor in handleDiscoverySelection(selection) }
        }
    }

    /// Reacts to a settled `BridgeDiscoverySelection` — either from automatic discovery
    /// (`bridgeAutoDiscoveryEnabled`) or from the "Discover on LAN" button here.
    private func handleDiscoverySelection(_ selection: BridgeDiscoverySelection) {
        isDiscovering = false
        switch selection {
        case .none:
            discoveredHosts = []
        case .autoConnect(let host):
            discoveredHosts = []
            bridgeURLText = host.webSocketURL?.absoluteString ?? bridgeURLText
            bridgeEnabled = true
            bridgeStatus = .connected(url: bridgeURLText)
        case .ambiguous(let hosts):
            discoveredHosts = hosts
        }
    }

    /// Starts (or re-starts) LAN discovery — a no-op if already searching.
    private func startLanDiscovery() {
        guard !isDiscovering else { return }
        isDiscovering = true
        discoveredHosts = []
        HakkaInterceptor.shared.discoverBridge()
    }

    /// Connects to a host picked from the "many hosts found" list.
    private func connect(to host: DiscoveredBridgeHost) {
        guard let url = host.webSocketURL else { return }
        bridgeURLText = url.absoluteString
        bridgeEnabled = true
        applyBridgeConnect(true)
        discoveredHosts = []
    }

    private func applyMaxRecords() {
        guard let n = Int(maxRecordsText.trimmingCharacters(in: .whitespaces)) else { return }
        let clamped = max(10, min(5_000, n))
        maxRecords = clamped
        maxRecordsText = String(clamped)
        // maxRequests is fixed at interceptor init (ring buffer size) and can't
        // be resized without re-init — the config is updated anyway so any
        // future config consumers see the intended value. Mirrors RN behavior.
        HakkaInterceptor.shared.updateConfig { $0.replacing(maxRequests: clamped) }
    }

    private func applyMaxAge() {
        let interval: TimeInterval? = maxAge > 0 ? maxAge : nil
        HakkaInterceptor.shared.updateConfig { $0.replacing(maxAge: interval) }
    }

    private func applyRedactBody() {
        let fields = redactBodyText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        let joined = fields.joined(separator: ", ")
        redactBodyText = joined
        HakkaInterceptor.shared.updateConfig { $0.replacing(sensitiveBodyFields: Set(fields)) }
    }

    private func applyBridgeConnect(_ enabled: Bool) {
        if enabled {
            let urlString = bridgeURLText.isEmpty ? Self.defaultBridgeURL : bridgeURLText
            bridgeURLText = urlString
            guard let url = URL(string: urlString) else { return }
            HakkaInterceptor.shared.updateConfig { $0.replacing(bridgeURL: url) }
            let client = HakkaBridgeClient(url: url)
            bridgeClient?.stop()
            bridgeClient = client
            bridgeStatus = .connecting(url: urlString)
            client.start()
            // Poll for connected status via a small delay heuristic (BridgeClient has no status callback).
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1))
                if bridgeEnabled {
                    bridgeStatus = .connected(url: urlString)
                }
            }
        } else {
            bridgeClient?.stop()
            bridgeClient = nil
            bridgeStatus = .disconnected
            HakkaInterceptor.shared.updateConfig { $0.replacing(bridgeURL: .some(nil)) }
        }
    }

    private func applyBridgeURL() {
        guard bridgeEnabled else { return }
        applyBridgeConnect(false)
        applyBridgeConnect(true)
    }
}

// MARK: - BridgeConnectionState

private enum BridgeConnectionState: Equatable {
    case disconnected
    case connecting(url: String)
    case connected(url: String)
    case error(String)
}

// MARK: - HakkaConfig.replacing(bridgeURL:) double-optional helper

// HakkaConfig.replacing(bridgeURL:) takes `URL??` to distinguish "keep
// existing" (nil) from "set to nil" (.some(nil)). This typed convenience
// avoids double-optional confusion at the call site.
private extension HakkaConfig {
    func replacing(bridgeURL newURL: URL?) -> HakkaConfig {
        replacing(bridgeURL: Optional(newURL))
    }
}

#if DEBUG
#Preview("Settings") { SettingsView() }
#endif
#endif // canImport(UIKit)
