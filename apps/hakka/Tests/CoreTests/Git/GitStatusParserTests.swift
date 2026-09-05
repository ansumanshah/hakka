import Foundation
import Testing
@testable import HakkaCore

/// Feeds `GitStatusParser` hand-built `git status --porcelain=v2 --branch -z`
/// output rather than real command output — the parser's job is purely
/// string-to-model, so pinning down every record shape (ordinary, renamed,
/// unmerged, untracked, ignored, detached HEAD) deterministically here is
/// more precise than depending on which shapes a real repository happens to
/// produce. `GitRepositoryIntegrationTests` covers the real-git round trip.
@Suite("GitStatusParser")
struct GitStatusParserTests {
    @Test func parsesTheCurrentBranchFromTheBranchHeadHeader() {
        let output = "# branch.oid abcdef0123456789\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0"
        let status = GitStatusParser.parse(output)
        #expect(status.branch == "main")
        #expect(status.entries.isEmpty)
        #expect(status.isClean)
    }

    @Test func detachedHeadParsesToANilBranchRatherThanTheLiteralText() {
        let output = "# branch.oid abcdef0123456789\0# branch.head (detached)\0"
        #expect(GitStatusParser.parse(output).branch == nil)
    }

    @Test func ordinaryEntrySplitsIndexAndWorktreeStatusFromTheXYPair() {
        let output = """
        1 M. N... 100644 100644 100644 aaaa bbbb staged.txt
        1 .M N... 100644 100644 100644 aaaa bbbb unstaged.txt
        1 MM N... 100644 100644 100644 aaaa bbbb both.txt
        """.replacingOccurrences(of: "\n", with: "\0")
        let status = GitStatusParser.parse(output)
        #expect(status.entries.count == 3)
        #expect(status.staged.map(\.path).sorted() == ["both.txt", "staged.txt"])
        #expect(status.unstaged.map(\.path).sorted() == ["both.txt", "unstaged.txt"])
    }

    @Test func renamedEntryCapturesBothPathsFromNulSeparatedRecords() {
        let output = "2 R. N... 100644 100644 100644 aaaa bbbb R100 new-name.txt\0old-name.txt"
        let status = GitStatusParser.parse(output)
        guard let entry = status.entries.first else {
            Issue.record("expected one parsed entry")
            return
        }
        #expect(status.entries.count == 1)
        #expect(entry.path == "new-name.txt")
        #expect(entry.originalPath == "old-name.txt")
        #expect(entry.isStaged)
    }

    @Test func untrackedAndIgnoredEntriesAreBucketedSeparatelyFromChanges() {
        let output = "? new-file.txt\0! build/output.log"
        let status = GitStatusParser.parse(output)
        #expect(status.untracked.map(\.path) == ["new-file.txt"])
        #expect(status.entries.first { $0.isIgnored }?.path == "build/output.log")
        #expect(status.staged.isEmpty)
        #expect(status.unstaged.isEmpty)
    }

    @Test func unmergedEntryParsesTheElevenFieldConflictRecord() {
        let output = "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflicted.txt"
        let status = GitStatusParser.parse(output)
        #expect(status.entries.count == 1)
        #expect(status.entries.first?.path == "conflicted.txt")
    }

    @Test func emptyOutputParsesToACleanStatusWithNoBranch() {
        let status = GitStatusParser.parse("")
        #expect(status.branch == nil)
        #expect(status.isClean)
        #expect(status.entries.isEmpty)
    }

    @Test func malformedLinesAreSkippedRatherThanCrashingTheParse() {
        // A truncated "1" record (missing every field after XY) must not
        // trap or produce a garbage entry — it is simply not a well-formed
        // record, so it is dropped.
        let output = "1 M.\0? real-untracked.txt"
        let status = GitStatusParser.parse(output)
        #expect(status.entries.map(\.path) == ["real-untracked.txt"])
    }
}
