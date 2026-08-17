#if canImport(UIKit)
import SwiftUI
import UIKit

// MARK: - KeyValueRow

/// Aligned key-value row: bold key (right-aligned) + value.
///
/// The key column shrinks to fit its content (mirrors web's
/// `.hakka-kv-key { width: 1% }` trick) rather than reserving a fixed band —
/// pass `keyColumnWidth` from a ``KeyColumnWidth`` preference sync to align
/// several rows in the same card to their widest key.
struct KeyValueRow: View {
    let key: String
    let value: String
    var mono: Bool = false
    var selectable: Bool = false
    var keyColor: Color = Theme.textTertiary
    var valueColor: Color = Theme.textSecondary
    var searchText: String = ""
    var copyable: Bool = true
    /// Explicit override. When nil, falls back to the ``OverviewCard``-scoped
    /// `environment(\.hakkaKeyColumnWidth)` (or intrinsic sizing outside a card).
    var keyColumnWidth: CGFloat? = nil

    @Environment(\.hakkaKeyColumnWidth) private var envKeyColumnWidth

    var body: some View {
        HStack(alignment: .top, spacing: Theme.s8) {
            Text(key)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(keyColor)
                .lineLimit(1)
                .background(
                    GeometryReader { proxy in
                        Color.clear.preference(key: KeyColumnWidth.self, value: proxy.size.width)
                    }
                )
                .frame(width: keyColumnWidth ?? envKeyColumnWidth, alignment: .trailing)

            Group {
                if selectable {
                    SearchHighlightedText(
                        text: value,
                        searchText: searchText,
                        font: mono ? .caption2.monospaced() : .caption2,
                        color: valueColor
                    )
                    .textSelection(.enabled)
                } else {
                    SearchHighlightedText(
                        text: value,
                        searchText: searchText,
                        font: mono ? .caption2.monospaced() : .caption2,
                        color: valueColor
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard copyable else { return }
            UIPasteboard.general.string = value
            Haptics.light()
        }
        .contextMenu {
            if copyable {
                Button {
                    UIPasteboard.general.string = value
                    Haptics.light()
                } label: {
                    Label("Copy \(key)", systemImage: "doc.on.doc")
                }
            }
        }
    }
}

// MARK: - ColoredKeyValueRow

struct ColoredKeyValueRow: View {
    let key: String
    let value: String
    var searchText: String = ""
    var valueColor: Color = Theme.text
    var copyValue: String? = nil
    /// Shared key-column width from ``KeyColumnWidth`` — when set, the key
    /// shrinks to fit the widest key in the surrounding list instead of a
    /// fixed band. Falls back to intrinsic sizing (capped at 116pt) when nil.
    var keyColumnWidth: CGFloat? = nil

    var body: some View {
        HStack(alignment: .top, spacing: Theme.s8) {
            SearchHighlightedText(
                text: key,
                searchText: searchText,
                font: .caption2.monospaced().weight(.semibold),
                color: Theme.info
            )
            .lineLimit(1)
            .background(widthReporter)
            .frame(width: keyColumnWidth, alignment: .leading)
            .frame(maxWidth: keyColumnWidth == nil ? 116 : nil, alignment: .leading)

            SearchHighlightedText(
                text: value,
                searchText: searchText,
                font: .caption2.monospaced(),
                color: valueColor
            )
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Theme.s2)
        .contentShape(Rectangle())
        .onTapGesture {
            UIPasteboard.general.string = copyValue ?? "\(key): \(value)"
            Haptics.light()
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = copyValue ?? "\(key): \(value)"
                Haptics.light()
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
        }
    }

    private var widthReporter: some View {
        GeometryReader { proxy in
            Color.clear.preference(key: KeyColumnWidth.self, value: proxy.size.width)
        }
    }
}

// MARK: - KeyColumnWidth

/// Preference key that lets a list of ``ColoredKeyValueRow``s shrink their
/// shared key column to fit the widest key actually present — mirrors the
/// web `.hakka-kv-key { width: 1% }` shrink-to-fit trick, without a real
/// `<table>` to lean on.
struct KeyColumnWidth: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

// MARK: - OverviewCard

/// Bordered card used throughout the Overview tab (Request, Size, Connection,
/// WebSocket…). Reads back its content's ``KeyColumnWidth`` preference so any
/// ``KeyValueRow``s inside share one shrink-to-fit key column, scoped to this
/// card rather than the whole tab.
struct OverviewCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    @State private var keyColumnWidth: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            SectionHeader(title: title)
            content()
                .environment(\.hakkaKeyColumnWidth, keyColumnWidth > 0 ? keyColumnWidth : nil)
        }
        .padding(Theme.s12)
        .background(Theme.surface.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusL)
                .stroke(Theme.border.opacity(0.35), lineWidth: 0.5)
        )
        .onPreferenceChange(KeyColumnWidth.self) { keyColumnWidth = $0 }
    }
}

// MARK: - Environment: hakkaKeyColumnWidth

private struct HakkaKeyColumnWidthKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
    /// Shrink-to-fit key column width shared by the ``KeyValueRow``s inside
    /// the current ``OverviewCard``. `nil` outside a card (row sizes to its
    /// own key's intrinsic width).
    var hakkaKeyColumnWidth: CGFloat? {
        get { self[HakkaKeyColumnWidthKey.self] }
        set { self[HakkaKeyColumnWidthKey.self] = newValue }
    }
}

#if DEBUG
#Preview("KeyValueRow") {
    VStack(spacing: Theme.s4) {
        KeyValueRow(key: "URL", value: "https://api.example.com/users", mono: true)
        KeyValueRow(key: "Status", value: "200 OK", valueColor: Theme.success)
        KeyValueRow(key: "Duration", value: "142ms")
    }
    .padding()
}

#Preview("OverviewCard") {
    OverviewCard(title: "Request") {
        KeyValueRow(key: "URL", value: "https://api.example.com/users", mono: true)
        KeyValueRow(key: "Method", value: "GET", mono: true)
        KeyValueRow(key: "Request ID", value: "a1b2c3", mono: true)
    }
    .padding()
    .background(Theme.bg)
}
#endif
#endif // canImport(UIKit)
