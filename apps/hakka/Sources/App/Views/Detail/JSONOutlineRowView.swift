import HakkaCore
import SwiftUI

/// One row of the JSON tree, rendered recursively: a disclosure for
/// containers (children materialize only while expanded), a key/value line
/// for leaves. Depth beyond two starts collapsed, mirroring the web tree's
/// default.
struct JSONOutlineRowView: View {
    let node: JSONOutlineNode
    let depth: Int
    let searchResult: JSONOutlineSearch.Result?

    @State private var isExpanded: Bool

    init(node: JSONOutlineNode, depth: Int, searchResult: JSONOutlineSearch.Result? = nil) {
        self.node = node
        self.depth = depth
        self.searchResult = searchResult
        _isExpanded = State(initialValue: depth < 2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            rowLine
            if effectiveExpanded, node.isExpandable {
                ForEach(node.children()) { child in
                    if searchResult?.includedNodeIDs.contains(child.id) ?? true {
                        JSONOutlineRowView(node: child, depth: depth + 1, searchResult: searchResult)
                    }
                }
                .padding(.leading, Spacing.ll)
                closingLine
            }
        }
    }

    private var rowLine: some View {
        HStack(alignment: .top, spacing: Spacing.xs) {
            if node.isExpandable {
                Button {
                    isExpanded.toggle()
                } label: {
                    Image(systemName: effectiveExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold)) // ui-token-check-ignore: disclosure chevron glyph
                        .foregroundStyle(.secondary)
                        .frame(width: 12)
                }
                .buttonStyle(.plain)
            } else {
                Spacer().frame(width: 12)
            }
            if let key = node.key {
                Text("\"\(key)\"").foregroundStyle(ThemeTokens.Code.key)
                Text(":").foregroundStyle(.secondary)
            }
            if node.isExpandable {
                Text(openBracket).foregroundStyle(.secondary)
                if !effectiveExpanded {
                    Text("\(node.childCount) \(node.childCount == 1 ? "item" : "items")")
                        .foregroundStyle(.secondary)
                    Text(closeBracket).foregroundStyle(.secondary)
                }
            } else if let value = node.displayValue {
                Text(value).foregroundStyle(colorForLeaf)
            }
        }
        .font(.caption.monospaced())
        .background(rowBackground)
    }

    private var closingLine: some View {
        HStack(alignment: .top, spacing: Spacing.xs) {
            Spacer().frame(width: 12)
            Text(closeBracket).foregroundStyle(.secondary)
        }
        .font(.caption.monospaced())
    }

    private var openBracket: String {
        node.kind == .array ? "[" : "{"
    }

    private var closeBracket: String {
        node.kind == .array ? "]" : "}"
    }

    private var effectiveExpanded: Bool {
        searchResult == nil ? isExpanded : true
    }

    @ViewBuilder
    private var rowBackground: some View {
        if searchResult?.matches.contains(where: { $0.path == node.id }) == true {
            RoundedRectangle(cornerRadius: 3).fill(Color.accentColor.opacity(0.18))
        }
    }

    private var colorForLeaf: Color {
        switch node.kind {
        case .string: ThemeTokens.Code.string
        case .number: ThemeTokens.Code.number
        case .bool: ThemeTokens.Code.boolean
        case .null: ThemeTokens.Code.null
        case .object, .array: .secondary
        }
    }
}
