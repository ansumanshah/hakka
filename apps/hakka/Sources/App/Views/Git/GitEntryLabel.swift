import HakkaCore
import SwiftUI

enum GitEntryLabel {
    static func code(for entry: GitStatusEntry) -> String {
        if entry.isUntracked { return "?" }
        if entry.isIgnored { return "!" }
        var code = ""
        if entry.indexStatus != "." { code.append(entry.indexStatus) }
        if entry.worktreeStatus != "." { code.append(entry.worktreeStatus) }
        return code.isEmpty ? "•" : code
    }

    static func color(for entry: GitStatusEntry) -> Color {
        if entry.isUntracked { return .secondary }
        if entry.indexStatus == "D" || entry.worktreeStatus == "D" { return ThemeTokens.Status.error }
        if entry.indexStatus == "A" { return ThemeTokens.Status.success }
        return ThemeTokens.Status.warning
    }
}
