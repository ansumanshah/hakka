import Foundation
import HakkaCommon
import SwiftUI

/// Formatting shared by the traffic list, response detail, and stats footer.
enum Fmt {
    static func duration(_ ms: Int64?) -> String {
        guard let ms else { return "–" }
        return ms < 1000 ? "\(ms)ms" : String(format: "%.2fs", Double(ms) / 1000)
    }

    static func bytes(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: count, countStyle: .memory)
    }

    static func statusColor(_ status: Int?) -> Color {
        guard let status else { return .secondary }
        switch status {
        case ..<300: return .green
        case ..<400: return .blue
        case ..<500: return .orange
        default: return .red
        }
    }

    static func methodColor(_ method: HttpMethod) -> Color {
        switch method {
        case .get: .green
        case .post: .orange
        case .put, .patch: .blue
        case .delete: .red
        case .head, .options: .secondary
        }
    }
}
