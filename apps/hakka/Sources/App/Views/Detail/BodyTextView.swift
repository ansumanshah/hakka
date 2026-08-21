import HakkaCore
import SwiftUI

/// Text body rendering shared by the raw and pretty viewers: the capped
/// window with search matches highlighted (active match stronger), the
/// hidden-characters footnote, and the load-full-body affordance. Syntax
/// coloring applies when the model's mode is pretty JSON.
struct BodyTextView: View {
    @Bindable var model: BodyViewerModel

    var body: some View {
        let capped = model.cappedDisplay

        VStack(alignment: .leading, spacing: 8) {
            BodySearchBar(
                searchText: $model.searchText,
                matchCount: model.matches.count,
                activeMatchIndex: model.activeMatchIndex,
                onPrevious: { model.advanceMatch(isForward: false) },
                onNext: { model.advanceMatch(isForward: true) }
            )
            ScrollView {
                Text(highlightedText(capped.displayedText))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 460)
            .padding(8)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 4))
            if capped.isTruncated {
                truncationFooter(capped)
            }
        }
    }

    private func truncationFooter(_ capped: CappedBody) -> some View {
        HStack(spacing: 12) {
            Text("… \(capped.hiddenCharacterCount.formatted()) more characters hidden")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            if model.isFullBodyLoaded {
                Text("Showing full body")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Button("Load Full Body") {
                    model.isFullBodyLoaded = true
                }
                .controlSize(.small)
            }
        }
    }

    /// The displayed window, syntax-colored for pretty JSON, with every
    /// match backgrounded and the active match emphasized.
    private func highlightedText(_ text: String) -> AttributedString {
        var attributed: AttributedString
        if model.mode == .pretty, model.isJSON {
            attributed = JSONSyntaxHighlighter.attributed(text)
        } else {
            attributed = AttributedString(text)
            attributed.font = .system(.caption, design: .monospaced)
        }

        let active = model.activeMatch
        for match in model.matches where match != active {
            applyBackground(match, to: &attributed, in: text, color: .yellow.opacity(0.35))
        }
        if let active {
            applyBackground(active, to: &attributed, in: text, color: .orange.opacity(0.6))
        }
        return attributed
    }

    private func applyBackground(_ match: BodyMatch, to attributed: inout AttributedString, in text: String, color: Color) {
        guard let start = text.index(text.startIndex, offsetBy: match.start, limitedBy: text.endIndex),
              let end = text.index(start, offsetBy: match.count, limitedBy: text.endIndex),
              let attributedStart = AttributedString.Index(start, within: attributed),
              let attributedEnd = AttributedString.Index(end, within: attributed)
        else { return }
        attributed[attributedStart..<attributedEnd].backgroundColor = color
    }
}
