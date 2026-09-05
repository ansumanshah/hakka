// @generated — do not edit. Synced from ios/Sources/UI/Detail/DetailBodyContentCard.swift
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

// MARK: - BodyContentCard
//
// See DetailBodyHelpers.swift for the split's overview. Constructed from
// `bodySection` there. Not `private` — this file is separate from its caller.

struct BodyContentCard: View {
    let title: String
    let content: String
    let searchText: String
    var isFormURLEncoded: Bool = false

    @State private var bodySearchText = ""
    @State private var showFormParsed = false
    // Raw/Tree toggle for JSON bodies. Defaults to Raw so the local search
    // field above (and the tab-level search) keeps highlighting exactly as
    // before — Tree is opt-in via one tap, mirroring RN's ContentTab default.
    @State private var showTree = false
    // Full-screen JSON reader — a bigger surface than the inline card for
    // deeply nested bodies, reusing JSONTreeView's own Raw/Tree toggle.
    @State private var showFullScreenJSON = false
    // Active match index (0-based) within the body-local search. Wraps via
    // goNext/goPrev, mirroring web's BodySearch activeIdx % total semantics.
    @State private var activeMatchIdx = 0

    /// Body after the `bodyDecoders` pipeline runs (gzip/deflate/sse/protobuf-wire/
    /// grpc-web decoding, gated on contentType/contentEncoding exactly like web's
    /// decodedRequestBody/decodedResponseBody). Every downstream consumer — search,
    /// copy, byte-count subtitle, JSON pretty-print — uses this, not raw `content`.
    private let decodedContent: String
    private let displayText: String
    private let isJSON: Bool
    /// Parsed tree for the Tree view — built from the full `decodedContent`,
    /// never the truncated `previewText` (truncation would break JSON syntax).
    private let rootNode: JSONNode?

    init(
        title: String,
        content: String,
        searchText: String,
        contentType: String? = nil,
        contentEncoding: String? = nil,
        isFormURLEncoded: Bool = false
    ) {
        self.title = title
        self.content = content
        self.searchText = searchText
        self.isFormURLEncoded = isFormURLEncoded

        let decoded = bodyDecoders.decode(content, contentType: contentType, contentEncoding: contentEncoding)
        self.decodedContent = decoded
        if let pretty = Fmt.prettyPrintedJSON(decoded) {
            displayText = pretty
            isJSON = true
            if let data = decoded.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) {
                rootNode = JSONNode.parse(json)
            } else {
                rootNode = nil
            }
        } else {
            displayText = decoded
            isJSON = false
            rootNode = nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            HStack(spacing: Theme.s8) {
                VStack(alignment: .leading, spacing: Theme.s2) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.text)
                    Text(subtitle)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.textTertiary)
                }
                Spacer()
                if isFormURLEncoded {
                    formToggleButton
                }
                if isJSON {
                    treeToggleButton
                    bodyAction(icon: "arrow.up.left.and.arrow.down.right", title: "Expand") {
                        Haptics.light()
                        showFullScreenJSON = true
                    }
                }
                bodyAction(icon: "doc.on.doc", title: "Copy") {
                    UIPasteboard.general.string = decodedContent
                    Haptics.light()
                }
            }

            if isFormURLEncoded && showFormParsed {
                FormURLEncodedParamsView(content: decodedContent, searchText: effectiveSearchText)
            } else if isJSON, showTree, let rootNode {
                InlineJSONView(rootNode: rootNode)
                    .contentShape(Rectangle())
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = decodedContent
                            Haptics.light()
                        } label: {
                            Label("Copy Body", systemImage: "doc.on.doc")
                        }
                    }
            } else {
                bodySearchField

                MatchHighlightedBody(
                    text: previewText,
                    query: effectiveSearchText,
                    activeIdx: activeMatchIdx
                )
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.s10)
                .background(Theme.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
                .contentShape(Rectangle())
                .contextMenu {
                    Button {
                        UIPasteboard.general.string = decodedContent
                        Haptics.light()
                    } label: {
                        Label("Copy Body", systemImage: "doc.on.doc")
                    }
                }

                if displayText.count > previewText.count {
                    Text("Previewing first \(Fmt.formatBytes(Int64(previewText.utf8.count)))")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
        }
        .padding(Theme.s12)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusL)
                .stroke(Theme.border.opacity(0.35), lineWidth: 0.5)
        )
        .sheet(isPresented: $showFullScreenJSON) {
            JSONTreeView(jsonString: decodedContent, title: title)
        }
    }

    private var subtitle: String {
        let type = isJSON ? "JSON" : (isFormURLEncoded ? "Form" : "Text")
        return "\(type) · \(Fmt.formatBytes(Int64(decodedContent.utf8.count)))"
    }

    private var formToggleButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) { showFormParsed.toggle() }
        } label: {
            Text(showFormParsed ? "Parsed" : "Raw")
                .font(.caption2.weight(.medium))
                .foregroundStyle(showFormParsed ? Theme.info : Theme.textSecondary)
                .padding(.horizontal, Theme.s8)
                .padding(.vertical, Theme.s4)
                .background(showFormParsed ? Theme.info.opacity(0.12) : Theme.surface.opacity(0.72))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    /// Raw/Tree toggle for JSON bodies — Tree renders the collapsible
    /// InlineJSONView; Raw keeps the existing search-highlighted plain text.
    private var treeToggleButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) { showTree.toggle() }
        } label: {
            Text(showTree ? "Tree" : "Raw")
                .font(.caption2.weight(.medium))
                .foregroundStyle(showTree ? Theme.info : Theme.textSecondary)
                .padding(.horizontal, Theme.s8)
                .padding(.vertical, Theme.s4)
                .background(showTree ? Theme.info.opacity(0.12) : Theme.surface.opacity(0.72))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var previewText: String {
        let limit = 3_500
        guard displayText.count > limit else { return displayText }
        return String(displayText.prefix(limit)) + "\n..."
    }

    private var effectiveSearchText: String {
        let local = bodySearchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !local.isEmpty { return local }
        return searchText
    }

    /// Total match count for the active query — used to clamp/wrap navigation
    /// and to render the "n/m" counter, mirroring web's BodySearch `total()`.
    private var matchCount: Int {
        MatchHighlightedBody.matchCount(in: previewText, query: effectiveSearchText)
    }

    private var bodySearchField: some View {
        HStack(spacing: Theme.s6) {
            Image(systemName: "magnifyingglass")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.textTertiary)
            TextField("Search this body", text: $bodySearchText)
                .textFieldStyle(.plain)
                .font(.caption2)
                .foregroundStyle(Theme.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: bodySearchText) { _ in
                    activeMatchIdx = 0
                }
            if !bodySearchText.isEmpty {
                if matchCount > 0 {
                    matchNavigator
                } else {
                    Text("No matches")
                        .font(.caption2)
                        .foregroundStyle(Theme.error)
                }
                Button {
                    bodySearchText = ""
                    activeMatchIdx = 0
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Theme.s10)
        .frame(height: HakkaMetrics.ControlHeight.field)
        .background(Theme.surfaceRaised.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
    }

    /// n/m counter + prev/next chevrons — mirrors web BodySearch's toolbar.
    private var matchNavigator: some View {
        HStack(spacing: Theme.s4) {
            Text("\((activeMatchIdx % max(matchCount, 1)) + 1)/\(matchCount)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textTertiary)
                .layoutPriority(1)

            Button {
                goPrev()
            } label: {
                Image(systemName: "chevron.up")
                    .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.info)
            .accessibilityLabel(Text("Previous match"))

            Button {
                goNext()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: HakkaMetrics.FontSize.xxs, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.info)
            .accessibilityLabel(Text("Next match"))
        }
    }

    private func goNext() {
        guard matchCount > 0 else { return }
        activeMatchIdx = (activeMatchIdx + 1) % matchCount
        Haptics.light()
    }

    private func goPrev() {
        guard matchCount > 0 else { return }
        activeMatchIdx = (activeMatchIdx - 1 + matchCount) % matchCount
        Haptics.light()
    }

    private func bodyAction(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: HakkaMetrics.ControlHeight.icon, height: HakkaMetrics.ControlHeight.icon)
                .hakkaControlGlass(cornerRadius: 10)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
    }
}
#endif // canImport(UIKit)
