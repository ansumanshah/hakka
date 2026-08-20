import Foundation

/// Turns a node's display name into a filesystem-safe path component.
///
/// A slug can never contain `/` or `.` (both are outside
/// `CharacterSet.alphanumerics`, so they collapse to `-` like every other
/// separator), which makes an escaping name — `"../../etc/passwd"`, a bare
/// `".."`, an empty string — structurally impossible to produce: there is no
/// character sequence `slug(for:)` can emit that `URL.appendingPathComponent`
/// would resolve outside the directory it's appended to.
enum CollectionFileNaming {
    /// Slugs are ASCII, so this is both a character and a byte budget. macOS
    /// allows 255 bytes per filename; the cap leaves room for the `.hakka`
    /// extension and a `-2`/`-3` collision suffix. Uncapped, a long request
    /// name made `write` fail with a bare "File name too long", which aborted
    /// the save partway through the tree — some nodes written, the rest and
    /// the stale-entry prune skipped.
    static let maxSlugLength = 200

    static func slug(for name: String) -> String {
        var result = ""
        result.reserveCapacity(name.count)
        var lastWasDash = false
        for scalar in name.lowercased().unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                result.unicodeScalars.append(scalar)
                lastWasDash = false
            } else if !result.isEmpty, !lastWasDash {
                result.append("-")
                lastWasDash = true
            }
        }
        if result.count > maxSlugLength {
            result = String(result.prefix(maxSlugLength))
        }
        while result.hasSuffix("-") {
            result.removeLast()
        }
        return result.isEmpty ? "untitled" : result
    }

    /// A slug unique within `used` (case-insensitive, matching common
    /// filesystems), suffixed `-2`, `-3`, … on collision. Reserves the
    /// returned slug in `used` before returning it.
    static func uniqueSlug(for name: String, used: inout Set<String>) -> String {
        let base = slug(for: name)
        var candidate = base
        var suffix = 2
        while used.contains(candidate) {
            candidate = "\(base)-\(suffix)"
            suffix += 1
        }
        used.insert(candidate)
        return candidate
    }
}
