import Foundation

/// A body clipped to the number of characters a text viewer renders before
/// the user asks for more. `hiddenCharacterCount` drives the "N more
/// characters hidden" footnote and the load-full-body affordance.
public struct CappedBody: Sendable, Equatable {
    /// The portion of the body the viewer renders.
    public let displayedText: String
    /// True when the body exceeded the cap and was clipped.
    public let isTruncated: Bool
    /// How many characters of the full body are not in `displayedText`.
    public let hiddenCharacterCount: Int

    public init(displayedText: String, isTruncated: Bool, hiddenCharacterCount: Int) {
        self.displayedText = displayedText
        self.isTruncated = isTruncated
        self.hiddenCharacterCount = hiddenCharacterCount
    }
}

/// Caps body text at a character count that keeps SwiftUI text layout and
/// highlight rendering responsive; the load-full affordance opts out.
public enum BodyDisplayCap {
    /// Mirrors the web overlay's body display cap.
    public static let characterLimit = 50_000

    public static func cap(_ text: String, at limit: Int = characterLimit) -> CappedBody {
        guard text.count > limit else {
            return CappedBody(displayedText: text, isTruncated: false, hiddenCharacterCount: 0)
        }
        return CappedBody(
            displayedText: String(text.prefix(limit)),
            isTruncated: true,
            hiddenCharacterCount: text.count - limit
        )
    }
}
