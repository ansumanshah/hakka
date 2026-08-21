import Foundation

/// Display-name collision policy for duplicating or moving a node among
/// siblings. Mirrors `CollectionFileNaming.uniqueSlug`'s suffix strategy —
/// numbered fallback on collision — but works on the human-readable name
/// shown in the sidebar rather than a filesystem slug, and reads as a
/// duplicate rather than a counter: "Get Users copy", "Get Users copy 2",
/// never "Get Users-2".
public enum CollectionNodeNaming {
    /// `existingNames` is every sibling's current display name — the node
    /// being duplicated or moved is not included. Comparison is
    /// case-insensitive, matching how a person reads two rows as "the same
    /// name" regardless of case.
    public static func uniqueName(for name: String, among existingNames: [String]) -> String {
        let used = Set(existingNames.map { $0.lowercased() })
        guard used.contains(name.lowercased()) else { return name }

        var suffix = 1
        var candidate = "\(name) copy"
        while used.contains(candidate.lowercased()) {
            suffix += 1
            candidate = "\(name) copy \(suffix)"
        }
        return candidate
    }
}
