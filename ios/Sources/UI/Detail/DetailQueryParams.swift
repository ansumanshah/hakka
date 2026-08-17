#if canImport(UIKit)
import HakkaCommon
import HakkaNetwork
import SwiftUI
import UIKit

// MARK: - QueryParamsView
//
// See DetailBodyHelpers.swift for the split's overview. Used from
// `queryParamsSection` there and from `BodyContentCard` (DetailBodyContentCard.swift).

/// Query-parameters (or form-urlencoded body) display with Decoded/Raw toggle.
/// The toggle is shown only when at least one value is percent-encoded.
struct QueryParamsView: View {
    let items: [URLQueryItem]
    let searchText: String

    @State private var showDecoded = true

    /// True when any name or value contains a percent-encoded sequence.
    private var hasEncoding: Bool {
        items.contains { item in
            isEncoded(item.name) || isEncoded(item.value ?? "")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s6) {
            HStack(spacing: Theme.s8) {
                SectionHeader(title: "Query Parameters")
                Spacer()
                if hasEncoding {
                    encodeToggle
                }
            }
            VStack(alignment: .leading, spacing: Theme.s4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    paramRow(item: item)
                }
            }
        }
    }

    private var encodeToggle: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) { showDecoded.toggle() }
        } label: {
            HStack(spacing: HakkaMetrics.Spacing.xxs) {
                Image(systemName: showDecoded ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .bold))
                Text(showDecoded ? "Decoded" : "Raw")
                    .font(.caption2.weight(.medium))
            }
            .foregroundStyle(showDecoded ? Theme.info : Theme.textSecondary)
            .padding(.horizontal, Theme.s8)
            .padding(.vertical, Theme.s4)
            .background(showDecoded ? Theme.info.opacity(0.12) : Theme.surface.opacity(0.72))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(showDecoded ? "Show raw values" : "Show decoded values"))
    }

    @ViewBuilder
    private func paramRow(item: URLQueryItem) -> some View {
        let name  = displayName(item.name)
        let value = displayValue(item.value ?? "")
        let copy  = "\(name)=\(value)"

        HStack(alignment: .top, spacing: Theme.s4) {
            SearchHighlightedText(
                text: name,
                searchText: searchText,
                font: .caption2.monospaced().weight(.medium),
                color: Theme.jsonKey
            )
            Text("=")
                .font(.caption2.monospaced())
                .foregroundStyle(Theme.textSecondary)
            SearchHighlightedText(
                text: value,
                searchText: searchText,
                font: .caption2.monospaced(),
                color: Theme.jsonString
            )
            .textSelection(.enabled)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            UIPasteboard.general.string = copy
            Haptics.light()
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = copy
                Haptics.light()
            } label: {
                Label("Copy Parameter", systemImage: "doc.on.doc")
            }
            if showDecoded, isEncoded(item.name) || isEncoded(item.value ?? "") {
                Button {
                    let raw = "\(item.name)=\(item.value ?? "")"
                    UIPasteboard.general.string = raw
                    Haptics.light()
                } label: {
                    Label("Copy Raw", systemImage: "chevron.left.forwardslash.chevron.right")
                }
            }
        }
    }

    // MARK: - Helpers

    private func displayName(_ raw: String) -> String {
        showDecoded ? HakkaUrlCodec.decodeUrl(raw) : raw
    }

    private func displayValue(_ raw: String) -> String {
        showDecoded ? HakkaUrlCodec.decodeUrl(raw) : raw
    }

    /// Returns true when the string contains a percent-encoded sequence (%XX).
    private func isEncoded(_ s: String) -> Bool {
        HakkaUrlCodec.isUrlEncoded(s)
    }
}

// MARK: - FormURLEncodedParamsView

/// Parses and displays application/x-www-form-urlencoded body as key=value rows with the decode toggle.
/// Not `private` — used from `BodyContentCard` in DetailBodyContentCard.swift.
struct FormURLEncodedParamsView: View {
    let content: String
    let searchText: String

    private var items: [URLQueryItem] {
        var components = URLComponents()
        components.percentEncodedQuery = content
        return components.queryItems ?? []
    }

    var body: some View {
        if items.isEmpty {
            EmptyView()
        } else {
            QueryParamsView(items: items, searchText: searchText)
        }
    }
}
#endif // canImport(UIKit)
