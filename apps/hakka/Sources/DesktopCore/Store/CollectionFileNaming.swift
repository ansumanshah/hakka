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
