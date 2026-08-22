import Foundation
import Testing
@testable import HakkaApp

/// `SetupSnippet.text` is what `FirstRunEmptyView`'s "Copy setup snippet"
/// button puts on the clipboard — pinned here against silent drift from the
/// README's React Native quick-start it's meant to mirror.
@Suite("SetupSnippet")
struct SetupSnippetTests {
    @Test func containsTheInstallCommand() {
        #expect(SetupSnippet.text.contains("npm install hakka-react-native"))
    }

    @Test func containsTheStartCall() {
        #expect(SetupSnippet.text.contains("import { Hakka } from 'hakka-react-native'"))
        #expect(SetupSnippet.text.contains("Hakka.start({ mode: 'auto' })"))
    }

    @Test func isNotEmptyOrWhitespaceOnly() {
        #expect(!SetupSnippet.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
}
