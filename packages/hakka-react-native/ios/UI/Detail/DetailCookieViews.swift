// @generated — do not edit. Synced from ios/Sources/UI/Detail/DetailCookieViews.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif
import SwiftUI
import UIKit

// MARK: - ParsedCookieRow
//
// See DetailHelpers.swift for the split's overview. Constructed from
// `overviewContent` in DetailOverviewContent.swift — not `private`.

/// Renders a fully parsed `Set-Cookie` response cookie.
/// Shows name=value on the primary row and attribute chips (Domain, Path, Expires,
/// Max-Age, HttpOnly, Secure, SameSite) below it.
struct ParsedCookieRow: View {
    let cookie: ParsedCookie
    let searchText: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s4) {
            // Name = Value
            HStack(alignment: .top, spacing: Theme.s4) {
                SearchHighlightedText(
                    text: cookie.name,
                    searchText: searchText,
                    font: .caption2.monospaced().weight(.semibold),
                    color: Theme.info
                )
                Text("=")
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.textSecondary)
                SearchHighlightedText(
                    text: cookie.value,
                    searchText: searchText,
                    font: .caption2.monospaced(),
                    color: Theme.warning
                )
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            let attrs = cookieAttributes
            if !attrs.isEmpty {
                FlowRow(spacing: Theme.s4) {
                    ForEach(attrs, id: \.label) { attr in
                        CookieAttrChip(label: attr.label, value: attr.value)
                    }
                }
            }
        }
        .padding(.vertical, Theme.s2)
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                UIPasteboard.general.string = "\(cookie.name)=\(cookie.value)"
                Haptics.light()
            } label: {
                Label("Copy Name=Value", systemImage: "doc.on.doc")
            }
        }
    }

    private struct CookieAttrInfo {
        let label: String
        let value: String?
    }

    private var cookieAttributes: [CookieAttrInfo] {
        var attrs: [CookieAttrInfo] = []
        if let domain = cookie.domain    { attrs.append(.init(label: "Domain", value: domain)) }
        if let path = cookie.path        { attrs.append(.init(label: "Path",   value: path)) }
        if let expires = cookie.expires  { attrs.append(.init(label: "Expires", value: expires)) }
        if let maxAge = cookie.maxAge    { attrs.append(.init(label: "Max-Age", value: "\(maxAge)s")) }
        if cookie.httpOnly               { attrs.append(.init(label: "HttpOnly", value: nil)) }
        if cookie.secure                 { attrs.append(.init(label: "Secure",   value: nil)) }
        if let ss = cookie.sameSite      { attrs.append(.init(label: "SameSite", value: ss.rawValue)) }
        return attrs
    }
}

// MARK: - CookieAttrChip

private struct CookieAttrChip: View {
    let label: String
    let value: String?

    var body: some View {
        Group {
            if let value {
                Text("\(label): \(value)")
            } else {
                Text(label)
            }
        }
        .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .medium))
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, Theme.s6)
        .padding(.vertical, HakkaMetrics.Spacing.xxs)
        .background(Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
    }
}

// MARK: - FlowRow (wrapping HStack)

/// A simple wrapping horizontal layout for chip badges.
private struct FlowRow: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
#endif // canImport(UIKit)
