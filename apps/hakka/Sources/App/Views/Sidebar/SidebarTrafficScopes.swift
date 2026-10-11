import HakkaCommon
import SwiftUI

/// Only measured record sources and URL hosts appear in capture navigation.
struct SidebarTrafficScopes: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if !app.traffic.requests.isEmpty {
            Section("Sources") {
                scopeButton("All Sources", selected: app.traffic.selectedSource == nil, count: app.traffic.requests.count) {
                    app.traffic.selectedSource = nil
                }
                ForEach(app.traffic.sourceCounts, id: \.source) { item in
                    scopeButton(item.source.displayName, selected: app.traffic.selectedSource == item.source, count: item.count) {
                        app.traffic.selectedSource = app.traffic.selectedSource == item.source ? nil : item.source
                    }
                }
            }
            Section("Domains") {
                scopeButton("All Domains", selected: app.traffic.selectedDomain == nil, count: app.traffic.requests.count) {
                    app.traffic.selectedDomain = nil
                }
                ForEach(app.traffic.domainCounts.prefix(100), id: \.domain) { item in
                    scopeButton(item.domain, selected: app.traffic.selectedDomain == item.domain, count: item.count) {
                        app.traffic.selectedDomain = app.traffic.selectedDomain == item.domain ? nil : item.domain
                    }
                }
                if app.traffic.domainCounts.count > 100 {
                    Text("First 100 domains shown. Search Live Traffic for others.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func scopeButton(_ title: String, selected: Bool, count: Int, action: @escaping () -> Void) -> some View {
        Button {
            action()
            app.select(.traffic)
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: selected ? "checkmark.circle.fill" : "network")
                    .foregroundStyle(selected ? ThemeTokens.Palette.accent : .secondary)
                Text(title).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: Spacing.xxs)
                Text(count.formatted()).foregroundStyle(.secondary).monospacedDigit()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Source identifies capture transport, not the client app. Domains match captured URL hosts.")
        .accessibilityLabel("\(title), \(count) requests\(selected ? ", selected" : "")")
    }
}
