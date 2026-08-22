import Foundation

/// The clipboard payload for `FirstRunEmptyView`'s "Copy setup snippet"
/// button — verbatim from the repo README's React Native quick-start
/// (`## Install` → `### React Native`), the SDK this desktop app's own
/// device examples (iOS Simulator, Pixel 8) target. One place so the
/// install command and the two docs links it references never drift from
/// what a developer actually pastes.
enum SetupSnippet {
    static let text = """
        npm install hakka-react-native @react-native-clipboard/clipboard

        import { Hakka } from 'hakka-react-native'

        Hakka.start({ mode: 'auto' })
        """
}
