// @generated — do not edit. Synced from ios/Sources/UI/Helpers/SharedViews.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif
import UIKit

// MARK: - SearchHighlightedText

struct SearchHighlightedText: View {
    let text: String
    var searchText: String = ""
    var font: Font = .caption
    var color: Color = Theme.text
    var highlightColor: Color = Theme.info
    var lineLimit: Int? = nil
    var truncationMode: Text.TruncationMode = .tail

    var body: some View {
        highlightedText
            .lineLimit(lineLimit)
            .truncationMode(truncationMode)
    }

    private var highlightedText: Text {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return Text(text)
                .font(font)
                .foregroundColor(color)
        }

        var result = Text("")
        for segment in segments(matching: query) {
            result = result + Text(segment.text)
                .font(font)
                .foregroundColor(segment.isMatch ? highlightColor : color)
        }
        return result
    }

    private func segments(matching query: String) -> [(text: String, isMatch: Bool)] {
        var output: [(String, Bool)] = []
        var cursor = text.startIndex

        while cursor < text.endIndex,
              let range = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive],
                                      range: cursor..<text.endIndex) {
            if cursor < range.lowerBound {
                output.append((String(text[cursor..<range.lowerBound]), false))
            }
            output.append((String(text[range]), true))
            cursor = range.upperBound
        }

        if cursor < text.endIndex {
            output.append((String(text[cursor..<text.endIndex]), false))
        }
        return output.isEmpty ? [(text, false)] : output
    }
}

// MARK: - MethodBadge

/// Method chip — Wok Hei grammar: outlined mono tint, method-colored text,
/// ~40%-opacity border, ~10% tint background, fixed width. Never a filled
/// pill with white text — chips whisper, status speaks.
struct MethodBadge: View {
    let method: HttpMethod

    private static let fixedWidth: CGFloat = 52

    var body: some View {
        Text(method.rawValue)
            .font(.system(size: HakkaMetrics.FontSize.xs, weight: .bold, design: .monospaced))
            .foregroundStyle(Theme.methodColor(for: method))
            .frame(width: Self.fixedWidth)
            .padding(.vertical, HakkaMetrics.Spacing.xxs)
            .background(Theme.methodColor(for: method).opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusS)
                    .stroke(Theme.methodColor(for: method).opacity(0.40), lineWidth: 1)
            )
    }
}

// MARK: - MethodLabel

/// Plain-text method for list rows — data, not a control. Method-colored
/// uppercase mono, no border, no background; one grammar across
/// web/RN/Android/iOS. `MethodBadge` stays for identity surfaces (Detail
/// header, Stats summaries).
struct MethodLabel: View {
    let method: HttpMethod

    private static let minimumWidth: CGFloat = 52

    var body: some View {
        Text(method.rawValue)
            .font(.caption.monospaced().weight(.bold))
            .foregroundStyle(Theme.methodColor(for: method))
            .frame(minWidth: Self.minimumWidth, alignment: .leading)
    }
}

// MARK: - HakkaChip

/// The one chip grammar (DESIGN.md): outlined, mono-tinted, ~40% border,
/// ~10% background tint at rest and active alike — text/border speak the
/// `tone` color only when active, quiet graphite otherwise. Never a filled
/// pill; flame/tone fill is reserved for the active/selected state alone.
/// Every screen with chip-like controls (Network filters, Rules segments +
/// method/phase rows, Settings retention, Logs level filters) points at this
/// one component instead of re-deriving a "filled" skin per screen.
struct HakkaChip: View {
    let label: String
    let isActive: Bool
    var tone: Color = Theme.accent
    var mono: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(mono
                    ? .system(size: HakkaMetrics.FontSize.xs, weight: .bold, design: .monospaced)
                    : .caption2.weight(isActive ? .semibold : .regular))
                .foregroundStyle(isActive ? tone : Theme.textTertiary)
                .padding(.horizontal, Theme.s8)
                .frame(height: Theme.ctlH)
                .background(isActive ? tone.opacity(0.10) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusS)
                        .stroke(isActive ? tone.opacity(0.40) : Theme.border, lineWidth: 1)
                )
                // Visual chip stays on the shared `ctlH` grammar (DESIGN.md); the
                // tap target grows to the 44pt `tapMin` floor via this
                // transparent container frame — SwiftUI never hit-tests
                // outside a view's own frame, so the container itself (not
                // just padding) must be 44pt tall for `.contentShape` below
                // to cover it.
                .frame(minHeight: Theme.tapMin)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - SectionHeader

/// Semibold section label.
struct SectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.textSecondary)
            .textCase(.uppercase)
            .tracking(0.7)
            .padding(.top, Theme.s6)
    }
}

// MARK: - Pill

/// Small text in a rounded background — used for connection info, tags.
struct Pill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, Theme.s6)
            .padding(.vertical, Theme.s4)
            .background(Theme.surfaceRaised, in: Capsule())
    }
}

// MARK: - Previews

#if DEBUG
#Preview("MethodBadge") {
    HStack(spacing: Theme.s8) {
        MethodBadge(method: .get)
        MethodBadge(method: .post)
        MethodBadge(method: .put)
        MethodBadge(method: .patch)
        MethodBadge(method: .delete)
    }
    .padding()
}

#Preview("HakkaChip") {
    HStack(spacing: Theme.s6) {
        HakkaChip(label: "ANY", isActive: true, tone: Theme.accent) {}
        HakkaChip(label: "GET", isActive: false, tone: Theme.methodGet) {}
        HakkaChip(label: "request", isActive: true, tone: Theme.info, mono: false) {}
    }
    .padding()
    .background(Theme.bg)
}

#Preview("Pill") {
    HStack(spacing: Theme.s6) {
        Pill(text: "H2")
        Pill(text: "TLSv1.3")
    }
    .padding()
}
#endif
#endif // canImport(UIKit)
