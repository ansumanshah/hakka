// @generated — do not edit. Synced from ios/Sources/UI/Settings/EnvironmentSection.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
import UIKit
import Network

// MARK: - EnvironmentSection

/// App/device/environment facts — merged into Settings from the old
/// standalone Info tab (DESIGN.md: system facts live at the bottom of
/// Settings, not their own top-level tab).
struct EnvironmentSection: View {

    @State private var networkStatus: String = "Checking\u{2026}"
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "com.noodleapps.hakka.EnvironmentSection.nwmonitor")

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s12) {
            Text("Environment")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.text)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.key) { index, row in
                    EnvironmentRow(row: row)
                    if index < rows.count - 1 {
                        Divider().overlay(Theme.border.opacity(0.5))
                    }
                }
            }
            .padding(Theme.s12)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
        }
        .padding(.vertical, Theme.s12)
        .onAppear { startNetworkMonitor() }
        .onDisappear { monitor.cancel() }
    }

    // MARK: - Rows

    private var rows: [EnvironmentRow.Row] {
        appRows + deviceRows + environmentRows
    }

    private var appRows: [EnvironmentRow.Row] {
        let bundle = Bundle.main
        let name = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? "Unknown"
        let bundleId = bundle.bundleIdentifier ?? "Unknown"
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "\u{2014}"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "\u{2014}"
        return [
            EnvironmentRow.Row(key: "Name", value: name),
            EnvironmentRow.Row(key: "Bundle ID", value: bundleId, mono: true),
            EnvironmentRow.Row(key: "Version", value: "\(version) (\(build))"),
        ]
    }

    private var deviceRows: [EnvironmentRow.Row] {
        let device = UIDevice.current
        let screen = UIScreen.main
        let size = screen.bounds.size
        return [
            EnvironmentRow.Row(key: "Device", value: deviceModel()),
            EnvironmentRow.Row(key: "iOS", value: "\(device.systemName) \(device.systemVersion)"),
            EnvironmentRow.Row(key: "Screen", value: String(format: "%.0f\u{00D7}%.0f @%.0fx", size.width, size.height, screen.scale)),
        ]
    }

    private var environmentRows: [EnvironmentRow.Row] {
        let locale = Locale.current
        let langCode = locale.language.languageCode?.identifier ?? "\u{2014}"
        let regionCode = locale.region?.identifier ?? "\u{2014}"
        return [
            EnvironmentRow.Row(key: "Network", value: networkStatus),
            EnvironmentRow.Row(key: "Locale", value: "\(langCode)-\(regionCode)"),
            EnvironmentRow.Row(key: "Timezone", value: TimeZone.current.identifier),
        ]
    }

    private func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafeBytes(of: &info.machine) { raw in
            let ptr = raw.baseAddress!.assumingMemoryBound(to: CChar.self)
            return String(cString: ptr)
        }
        return machine.isEmpty ? UIDevice.current.model : "\(UIDevice.current.model) (\(machine))"
    }

    // MARK: - Network Monitor

    private func startNetworkMonitor() {
        monitor.pathUpdateHandler = { path in
            let status: String
            switch path.status {
            case .satisfied:
                if path.usesInterfaceType(.wifi) {
                    status = "Wi-Fi"
                } else if path.usesInterfaceType(.cellular) {
                    status = "Cellular"
                } else if path.usesInterfaceType(.wiredEthernet) {
                    status = "Ethernet"
                } else {
                    status = "Connected"
                }
            case .unsatisfied:
                status = "No Connection"
            case .requiresConnection:
                status = "Requires Connection"
            @unknown default:
                status = "Unknown"
            }
            DispatchQueue.main.async { networkStatus = status }
        }
        monitor.start(queue: monitorQueue)
    }
}

// MARK: - EnvironmentRow

private struct EnvironmentRow: View {
    struct Row: Identifiable {
        let key: String
        let value: String
        var mono: Bool = false
        var id: String { key }
    }

    let row: Row

    var body: some View {
        HStack(alignment: .top, spacing: Theme.s8) {
            Text(row.key)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 72, alignment: .trailing)

            Text(row.value)
                .font(row.mono ? .caption2.monospaced() : .caption2)
                .foregroundStyle(Theme.textSecondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Theme.s6)
        .contentShape(Rectangle())
        .onTapGesture {
            UIPasteboard.general.string = row.value
            Haptics.light()
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = row.value
                Haptics.light()
            } label: {
                Label("Copy \(row.key)", systemImage: "doc.on.doc")
            }
        }
    }
}

#if DEBUG
#Preview("EnvironmentSection") {
    ScrollView { EnvironmentSection().padding(Theme.s16) }
        .background(Theme.bg)
}
#endif
#endif // canImport(UIKit)
