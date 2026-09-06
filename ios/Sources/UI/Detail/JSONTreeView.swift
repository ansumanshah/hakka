#if canImport(UIKit)
import SwiftUI
import UIKit

// MARK: - JSONNode

/// Recursive tree node representing a parsed JSON value.
enum JSONNode: Identifiable {
    case object(id: String, key: String?, children: [JSONNode])
    case array(id: String, key: String?, children: [JSONNode])
    case string(id: String, key: String?, value: String)
    case number(id: String, key: String?, value: String)
    case bool(id: String, key: String?, value: Bool)
    case null(id: String, key: String?)

    var id: String {
        switch self {
        case .object(let id, _, _), .array(let id, _, _),
            .string(let id, _, _), .number(let id, _, _),
            .bool(let id, _, _), .null(let id, _):
            return id
        }
    }

    var key: String? {
        switch self {
        case .object(_, let key, _), .array(_, let key, _),
            .string(_, let key, _), .number(_, let key, _),
            .bool(_, let key, _), .null(_, let key):
            return key
        }
    }

    static func parse(_ value: Any, key: String? = nil, path: String = "root") -> JSONNode {
        if let dict = value as? [String: Any] {
            let children = dict.keys.sorted().map { childKey in
                parse(dict[childKey]!, key: childKey, path: "\(path).\(childKey)")
            }
            return .object(id: path, key: key, children: children)
        } else if let arr = value as? [Any] {
            let children = arr.enumerated().map { index, item in
                parse(item, key: "[\(index)]", path: "\(path)[\(index)]")
            }
            return .array(id: path, key: key, children: children)
        } else if let str = value as? String {
            return .string(id: path, key: key, value: str)
        } else if let num = value as? NSNumber {
            if CFBooleanGetTypeID() == CFGetTypeID(num) {
                return .bool(id: path, key: key, value: num.boolValue)
            }
            return .number(id: path, key: key, value: "\(num)")
        } else if value is NSNull {
            return .null(id: path, key: key)
        } else {
            return .string(id: path, key: key, value: String(describing: value))
        }
    }
}

// MARK: - JSONTreeView

/// Full-screen JSON viewer with tree/raw toggle.
/// Reuses JSONNodeView for rendering (no duplicate recursive code).
struct JSONTreeView: View {
    let jsonString: String
    let title: String
    private let rootNode: JSONNode?
    private let prettyJSON: String

    @State private var showRaw = false
    @State private var collapsed: Set<String> = []
    @Environment(\.dismiss) private var dismiss

    init(jsonString: String, title: String) {
        self.jsonString = jsonString
        self.title = title
        if let data = jsonString.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) {
            rootNode = JSONNode.parse(json)
            prettyJSON = Fmt.prettyPrintedJSON(jsonString) ?? jsonString
        } else {
            rootNode = nil
            prettyJSON = jsonString
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                toggleBar
                Divider()
                content
            }
            .background(Theme.bg)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: Theme.s8) {
                        Button {
                            UIPasteboard.general.string = prettyJSON
                            Haptics.light()
                        } label: {
                            Image(systemName: "doc.on.doc")
                        }
                        Button("Done") { dismiss() }
                            .font(.subheadline.weight(.medium))
                    }
                }
            }
        }
    }

    private var toggleBar: some View {
        HStack {
            Spacer()
            Button(action: { showRaw.toggle() }) {
                HStack(spacing: Theme.s4) {
                    Image(systemName: showRaw ? "list.bullet.indent" : "doc.plaintext")
                    Text(showRaw ? "Tree" : "Raw")
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, Theme.s10)
                .padding(.vertical, Theme.s4)
                .background(Theme.surfaceRaised)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.trailing, Theme.s12)
        }
        .padding(.vertical, Theme.s8)
        .background(Theme.surface.opacity(0.6))
    }

    @ViewBuilder
    private var content: some View {
        if showRaw {
            ScrollView {
                Text(prettyJSON)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Theme.s12)
            }
        } else if let node = rootNode {
            ScrollView {
                JSONNodeView(node: node, depth: 0, collapsed: $collapsed)
                    .padding(Theme.s12)
            }
        } else {
            ScrollView {
                Text(jsonString)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Theme.s12)
            }
        }
    }

}

#if DEBUG
private let previewJSON = """
{"users":[{"id":1,"name":"Alice","email":"alice@example.com","active":true},{"id":2,"name":"Bob","email":null}],"total":2,"page":1}
"""
#Preview("JSON Tree") { JSONTreeView(jsonString: previewJSON, title: "Response Body") }
#endif
#endif // canImport(UIKit)
