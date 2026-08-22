import HakkaCore
import SwiftUI

/// One row of the JSON tree, rendered recursively: a disclosure for
/// containers (children materialize only while expanded), a key/value line
/// for leaves. Depth beyond two starts collapsed, mirroring the web tree's
/// default.
struct JSONOutlineRowView: View {
    let node: JSONOutlineNode
    let depth: Int

    @State private var isExpanded: Bool

    init(node: JSONOutlineNode, depth: Int) {
        self.node = node
        self.depth = depth
        _isExpanded = State(initialValue: depth < 2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            rowLine
            if isExpanded, node.isExpandable {
                ForEach(node.children()) { child in
                    JSONOutlineRowView(node: child, depth: depth + 1)
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
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold))  // ui-token-check-ignore: disclosure chevron glyph
                        .foregroundStyle(.secondary)
                        .frame(width: 12)
                }
                .buttonStyle(.plain)
            } else {
                Spacer().frame(width: 12)
            }
            if let key = node.key {
                Text("\"\(key)\"").foregroundStyle(.purple)
                Text(":").foregroundStyle(.secondary)
            }
            if node.isExpandable {
                Text(openBracket).foregroundStyle(.secondary)
                if !isExpanded {
                    Text("\(node.childCount) \(node.childCount == 1 ? "item" : "items")")
                        .foregroundStyle(.secondary)
                    Text(closeBracket).foregroundStyle(.secondary)
                }
            } else if let value = node.displayValue {
                Text(value).foregroundStyle(colorForLeaf)
            }
        }
        .font(.caption.monospaced())
    }

    private var closingLine: some View {
        HStack(alignment: .top, spacing: Spacing.xs) {
            Spacer().frame(width: 12)
            Text(closeBracket).foregroundStyle(.secondary)
        }
        .font(.caption.monospaced())
    }

    private var openBracket: String { node.kind == .array ? "[" : "{" }
    private var closeBracket: String { node.kind == .array ? "]" : "}" }

    private var colorForLeaf: Color {
        switch node.kind {
        case .string: .blue
        case .number: .orange
        case .bool, .null: .pink
        case .object, .array: .secondary
        }
    }
}
