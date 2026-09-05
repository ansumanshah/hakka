// @generated — do not edit. Synced from ios/Sources/UI/Detail/JSONNodeView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
import UIKit

// MARK: - JSONNodeView

/// Flat JSON renderer with syntax highlighting:
///   - Syntax-colored keys and values
///   - Trailing commas, collapsed `{…}` with count
///   - Indent guides (faint vertical lines)
///   - Long-press to copy value
///   - Long strings truncated with "…"
struct JSONNodeView: View {
    let node: JSONNode
    let depth: Int
    @Binding var collapsed: Set<String>

    private let indentWidth: CGFloat = 16
    private let maxStringLength = 80

    var body: some View {
        let rows = buildRows(node, depth: depth, isLast: true)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows, id: \.id) { row in
                rowView(row)
            }
        }
    }

    // MARK: - Row rendering

    private func rowView(_ row: JSONRow) -> some View {
        HStack(spacing: 0) {
            // Indent guides
            ForEach(0..<row.indent, id: \.self) { level in
                Rectangle()
                    .fill(level == row.indent - 1 ? Theme.border.opacity(0.4) : Color.clear)
                    .frame(width: 1)
                    .padding(.leading, indentWidth - 1)
            }

            // SF Symbol chevron for toggleable rows
            if row.isToggleable {
                Image(systemName: row.isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 7, weight: .bold))  // ui-token-check-ignore: one-off glyph/micro-label size, outside the type scale
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 14)
                    .padding(.leading, row.indent > 0 ? Theme.s4 : 0)
            } else {
                Spacer().frame(width: row.indent > 0 ? 14 + Theme.s4 : 14)
            }

            Text(row.text)
                .font(.system(size: 12.5, design: .monospaced))  // ui-token-check-ignore: one-off glyph/micro-label size, outside the type scale
                .tracking(-0.2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        // Toggleable rows get extra vertical padding so the chevron's tap
        // target (the whole row, via contentShape below) hits the 44pt HIG
        // minimum — via padding, not by inflating the glyph itself.
        .padding(.vertical, row.isToggleable ? 15 : 2.5)
        .contentShape(Rectangle())
        .onTapGesture {
            guard row.isToggleable else { return }
            withAnimation(.easeInOut(duration: 0.15)) {
                if collapsed.contains(row.id) { collapsed.remove(row.id) }
                else { collapsed.insert(row.id) }
            }
        }
        .onLongPressGesture {
            guard let copyable = row.copyValue else { return }
            UIPasteboard.general.string = copyable
            Haptics.light()
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = row.copyValue ?? String(row.text.characters)
                Haptics.light()
            } label: {
                Label("Copy Value", systemImage: "doc.on.doc")
            }
        }
    }

    // MARK: - Build rows

    private func buildRows(_ node: JSONNode, depth: Int, isLast: Bool) -> [JSONRow] {
        let comma = isLast ? "" : ","
        switch node {
        case .object(let id, let key, let children):
            return containerRows(id: id, key: key, open: "{", close: "}" + comma,
                                  children: children, depth: depth, isLast: isLast)
        case .array(let id, let key, let children):
            return containerRows(id: id, key: key, open: "[", close: "]" + comma,
                                  children: children, depth: depth, isLast: isLast)
        case .string(let id, let key, let value):
            let display = value.count > maxStringLength
                ? String(value.prefix(maxStringLength)) + "…"
                : value
            return [JSONRow(id: id, indent: depth,
                            text: leafText(key: key, value: "\"\(display)\"", color: Theme.jsonString, comma: comma),
                            copyValue: value)]
        case .number(let id, let key, let value):
            return [JSONRow(id: id, indent: depth,
                            text: leafText(key: key, value: value, color: Theme.jsonNumber, comma: comma),
                            copyValue: value)]
        case .bool(let id, let key, let value):
            let str = value ? "true" : "false"
            return [JSONRow(id: id, indent: depth,
                            text: leafText(key: key, value: str, color: Theme.jsonBool, comma: comma),
                            copyValue: str)]
        case .null(let id, let key):
            return [JSONRow(id: id, indent: depth,
                            text: leafText(key: key, value: "null", color: Theme.jsonNull, comma: comma),
                            copyValue: "null")]
        }
    }

    private func containerRows(id: String, key: String?, open: String, close: String,
                                children: [JSONNode], depth: Int, isLast: Bool) -> [JSONRow] {
        let isClosed = collapsed.contains(id)

        var header = AttributedString()
        if let key {
            header.append(keyStyle("\"\(key)\""))
            header.append(punct(": "))
        }
        if isClosed {
            header.append(punct(open))
            header.append(collapsedHint(" \(children.count) items "))
            header.append(punct(close))
        } else {
            header.append(punct(open))
        }

        var rows = [JSONRow(id: id, indent: depth, text: header, isToggleable: true, isExpanded: !isClosed)]

        if !isClosed {
            for (i, child) in children.enumerated() {
                rows.append(contentsOf: buildRows(child, depth: depth + 1, isLast: i == children.count - 1))
            }
            rows.append(JSONRow(id: "\(id)_close", indent: depth, text: punct(close)))
        }
        return rows
    }

    // MARK: - AttributedString helpers

    private func leafText(key: String?, value: String, color: Color, comma: String) -> AttributedString {
        var result = AttributedString()
        if let key {
            result.append(keyStyle("\"\(key)\""))
            result.append(punct(": "))
        }
        result.append(valueStyle(value, color))
        if !comma.isEmpty { result.append(punct(comma)) }
        return result
    }

    /// Punctuation — braces, brackets, commas, colons (muted)
    private func punct(_ str: String) -> AttributedString {
        var a = AttributedString(str)
        a.foregroundColor = Theme.jsonPunctuation
        return a
    }

    /// Key name — bold, system label color
    private func keyStyle(_ str: String) -> AttributedString {
        var a = AttributedString(str)
        a.foregroundColor = Theme.jsonKey
        a.font = .system(size: 12.5, weight: .semibold, design: .monospaced)  // ui-token-check-ignore: one-off glyph/micro-label size, outside the type scale
        return a
    }

    /// Value — syntax colored (red strings, blue numbers, pink bools)
    private func valueStyle(_ str: String, _ color: Color) -> AttributedString {
        var a = AttributedString(str)
        a.foregroundColor = color
        return a
    }

    /// Collapsed count hint — subtle badge
    private func collapsedHint(_ str: String) -> AttributedString {
        var a = AttributedString(str)
        a.foregroundColor = Theme.textTertiary
        a.font = .system(size: HakkaMetrics.FontSize.sm, weight: .medium, design: .monospaced)
        return a
    }
}

// MARK: - JSONRow

private struct JSONRow: Identifiable {
    let id: String
    let indent: Int
    let text: AttributedString
    var isToggleable: Bool = false
    var isExpanded: Bool = false
    var copyValue: String? = nil
}
#endif // canImport(UIKit)
