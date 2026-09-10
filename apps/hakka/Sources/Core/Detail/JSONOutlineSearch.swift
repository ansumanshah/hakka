import Foundation

/// Finds JSON outline nodes by key, scalar value, or outline path. Results are
/// deliberately bounded so a response with a very large JSON body cannot turn
/// an interactive filter into an unbounded walk.
public enum JSONOutlineSearch {
    public enum Scope: String, CaseIterable, Identifiable, Sendable {
        case all = "All"
        case key = "Key"
        case value = "Value"
        case path = "Path"

        public var id: String {
            rawValue
        }

        public var placeholder: String {
            switch self {
            case .all: "Search key, value, or path"
            case .key: "Search keys"
            case .value: "Search values"
            case .path: "Search paths, for example users[0].name"
            }
        }
    }

    public struct Match: Equatable, Identifiable, Sendable {
        public let path: String
        public let key: String?
        public let value: String?

        public var id: String {
            path
        }
    }

    public struct Result: Sendable {
        public let matches: [Match]
        public let includedNodeIDs: Set<String>
        public let isTruncated: Bool
        public let scannedNodeCount: Int

        public var isEmpty: Bool {
            matches.isEmpty
        }
    }

    /// Limits an interactive search to a useful amount of work and output.
    public struct Limits: Sendable {
        public let maximumNodes: Int
        public let maximumMatches: Int

        public init(maximumNodes: Int = 10000, maximumMatches: Int = 500) {
            self.maximumNodes = max(1, maximumNodes)
            self.maximumMatches = max(1, maximumMatches)
        }
    }

    /// Searches a parsed outline case-insensitively. Each result retains its
    /// parent path so callers can display just the branches that lead to it.
    public static func search(
        _ query: String,
        in root: JSONOutlineNode,
        scope: Scope = .all,
        limits: Limits = Limits()
    ) -> Result {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else {
            return Result(matches: [], includedNodeIDs: [], isTruncated: false, scannedNodeCount: 0)
        }

        var matches: [Match] = []
        var includedNodeIDs: Set<String> = []
        var scannedNodeCount = 0
        var isTruncated = false

        func visit(_ node: JSONOutlineNode, ancestors: [String]) {
            guard scannedNodeCount < limits.maximumNodes else {
                isTruncated = true
                return
            }
            scannedNodeCount += 1

            if matches.count < limits.maximumMatches, matchesNode(node, needle: needle, scope: scope) {
                matches.append(Match(path: node.id, key: node.key, value: node.displayValue))
                includedNodeIDs.formUnion(ancestors)
                includedNodeIDs.insert(node.id)
            } else if matches.count == limits.maximumMatches {
                isTruncated = true
                return
            }

            guard node.isExpandable else { return }
            let lineage = ancestors + [node.id]
            for child in node.children() {
                visit(child, ancestors: lineage)
                if isTruncated {
                    return
                }
            }
        }

        visit(root, ancestors: [])
        return Result(
            matches: matches,
            includedNodeIDs: includedNodeIDs,
            isTruncated: isTruncated,
            scannedNodeCount: scannedNodeCount
        )
    }

    private static func matchesNode(_ node: JSONOutlineNode, needle: String, scope: Scope) -> Bool {
        let keyMatches = node.key?.localizedCaseInsensitiveContains(needle) == true
        let valueMatches = node.displayValue?.localizedCaseInsensitiveContains(needle) == true
        let pathMatches = node.id.localizedCaseInsensitiveContains(needle)

        return switch scope {
        case .all: keyMatches || valueMatches || pathMatches
        case .key: keyMatches
        case .value: valueMatches
        case .path: pathMatches
        }
    }
}
