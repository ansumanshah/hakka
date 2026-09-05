// @generated — do not edit. Synced from ios/Sources/UI/List/ListHelpers.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
import UIKit
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif

// MARK: - Stats Bar

/// Compact request-count / latency / error summary for the Network list
/// header. Deliberately narrow: request + error counts are exact and always
/// safe to show; average latency is a sampled metric and renders an em dash
/// — never a truncated fragment — until a real duration sample exists. Byte
/// totals and UI frame metrics live on the Stats tab instead of being
/// crammed into this row.
struct StatsBar: View {
    let requests: [NetworkRequest]

    var body: some View {
        let total = requests.count
        let durations = requests.compactMap { $0.duration }
        let errors = requests.filter { ($0.status ?? 0) >= 400 || $0.error != nil }.count

        HStack(spacing: Theme.s6) {
            dataText("\(total)", total == 1 ? "request" : "requests", color: errors > 0 ? Theme.warning : Theme.textSecondary)

            Text("\u{00B7}").foregroundStyle(Theme.textTertiary)
            dataText(avgLatencyText(durations), "average", color: durations.isEmpty ? Theme.textTertiary : Theme.info)

            if errors > 0 {
                Text("\u{00B7}").foregroundStyle(Theme.textTertiary)
                dataText("\(errors)", errors == 1 ? "issue" : "issues", color: Theme.warning)
            }
        }
        .font(.caption)
        // Never let a value clip mid-character: this bar reports its natural
        // width rather than being squeezed/truncated — narrow by
        // construction (3 short fields), verified at 375pt.
        .fixedSize(horizontal: true, vertical: false)
    }

    /// Sampled metric — must never render a partial/truncated value.
    /// Renders an em dash until at least one real duration sample exists.
    private func avgLatencyText(_ durations: [Int64]) -> String {
        guard !durations.isEmpty else { return "\u{2014}" }
        let avg = durations.reduce(0, +) / Int64(durations.count)
        return Fmt.formatDuration(avg)
    }

    private func dataText(_ value: String, _ label: String, color: Color) -> some View {
        HStack(spacing: Theme.s2) {
            Text(value)
                .fontWeight(.semibold)
                .foregroundStyle(color)
            if !label.isEmpty {
                Text(label)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
    }
}

// MARK: - Empty State

struct EmptyState: View {
    var body: some View {
        VStack(spacing: Theme.s14) {
            Image(systemName: "network.slash")
                .font(.system(size: 44))  // ui-token-check-ignore: one-off glyph/micro-label size, outside the type scale
                .foregroundStyle(Theme.textTertiary)
            VStack(spacing: Theme.s4) {
                Text("No requests captured")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textSecondary)
                Text("Network activity will appear here")
                    .font(.caption)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 60)  // ui-token-check-ignore: empty-state optical inset
    }
}

// MARK: - Context Menu

/// Builds context menu items for a request row.
struct RequestContextMenu: View {
    let request: NetworkRequest
    let isPinned: Bool
    let onPin: () -> Void
    let onShare: (ShareItems) -> Void

    var body: some View {
        Button(action: onPin) {
            Label(
                isPinned ? "Unpin" : "Pin",
                systemImage: isPinned ? "pin.slash" : "pin"
            )
        }

        Button {
            Haptics.light()
            UIPasteboard.general.string = CurlExporter.export(request)
        } label: {
            Label("Copy cURL", systemImage: "terminal")
        }

        Button {
            UIPasteboard.general.string = request.url
        } label: {
            Label("Copy URL", systemImage: "link")
        }

        Button {
            Haptics.medium()
            onShare(ShareItems(items: [TextExporter.export(request)]))
        } label: {
            Label("Share", systemImage: "square.and.arrow.up")
        }
    }
}

// MARK: - ShareItems

/// Wrapper to make share items identifiable for `.sheet(item:)`.
struct ShareItems: Identifiable {
    let id = UUID()
    let items: [Any]
}

// MARK: - Report Helpers

enum ReportHelper {
    /// Build share items from a batch of requests (text report + .har + .postman_collection.json + .otel.json).
    static func buildShareItems(from batch: [NetworkRequest]) -> ShareItems {
        let report = ReportBuilder.build(requests: batch)
        let tmp = FileManager.default.temporaryDirectory
        let harURL = tmp.appendingPathComponent("hakka-report.har")
        try? report.har.write(to: harURL, atomically: true, encoding: .utf8)
        var items: [Any] = [report.text, harURL]
        if let postman = PostmanExporter.export(batch, prettyPrint: true) {
            let postmanURL = tmp.appendingPathComponent("hakka-collection.postman_collection.json")
            try? postman.write(to: postmanURL, atomically: true, encoding: .utf8)
            items.append(postmanURL)
        }
        if let otel = otelJson(from: batch) {
            let otelURL = tmp.appendingPathComponent("hakka-report.otel.json")
            try? otel.write(to: otelURL, atomically: true, encoding: .utf8)
            items.append(otelURL)
        }
        return ShareItems(items: items)
    }

    /// Build share items for a single request (text report + .har + .postman_collection.json + .otel.json).
    static func buildShareItems(from request: NetworkRequest) -> ShareItems {
        buildShareItems(from: [request])
    }

    /// Pretty-printed OTel JSON for a batch of requests, matching the RN/web `nJson` export.
    static func otelJson(from requests: [NetworkRequest]) -> String? {
        let records = requests.map { NetworkRecord.from($0) }
        let payload = recordsToOtelJson(records)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(payload) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

#if DEBUG
#Preview("StatsBar") {
    VStack(alignment: .leading, spacing: Theme.s12) {
        StatsBar(requests: PreviewData.batch)
        StatsBar(requests: []) // no samples yet — avg renders an em dash, not "--" or a clip
    }
    .padding()
    .background(Theme.bg)
}
#Preview("EmptyState") {
    EmptyState()
        .background(Theme.bg)
}
#endif
#endif // canImport(UIKit)
