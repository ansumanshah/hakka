import Foundation

// MARK: - JSONDepthGuard

/// Shared nesting-depth scanner for JSON bodies, checked before every
/// `JSONSerialization` parse of network-supplied or stored data.
/// `JSONSerialization` recurses as it parses and can overflow the stack
/// (SIGBUS, not a throw) on deeply nested input rather than throwing, so
/// depth must be checked before parsing, not after — `try?` cannot catch a
/// stack overflow.
public enum JSONDepthGuard {
    /// Scans for bracket nesting past `limit` without building any structure.
    /// Bytes, not characters, since every byte that matters here is ASCII and
    /// multi-byte UTF-8 continuation bytes never collide with them.
    public static func exceedsDepthLimit(_ body: String, limit: Int) -> Bool {
        var depth = 0
        var inString = false
        var escaped = false
        for byte in body.utf8 {
            if escaped {
                escaped = false
                continue
            }
            if inString {
                if byte == 0x5C { escaped = true } else if byte == 0x22 { inString = false }
                continue
            }
            switch byte {
            case 0x22: inString = true
            case 0x7B, 0x5B:
                depth += 1
                if depth > limit { return true }
            case 0x7D, 0x5D: depth -= 1
            default: break
            }
        }
        return false
    }
}
