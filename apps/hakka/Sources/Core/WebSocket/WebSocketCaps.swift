import Foundation

/// Bounds for a desktop-initiated WebSocket console. A socket is unbounded
/// by nature — losing the connection because the inspector's memory filled
/// up would be a worse bug than a truncated console, so both caps stop
/// *capture*, never the socket itself.
public enum WebSocketCaps {
    /// Per-frame payload cap: 64 KB. Double the SDK's passive-capture cap
    /// (`HakkaCommon.WsMessage`'s doc comment: "base64 of the bytes when
    /// within the 32KB capture cap"). The desktop console is one engineer
    /// interactively poking at one connection, not a device's full traffic
    /// firehose being relayed over the bridge wire — a larger single frame
    /// is still cheap to hold and render, and keeping the same order of
    /// magnitude as the SDK's cap keeps the two capture models comparable
    /// instead of picking an unrelated number.
    public static let perFramePayloadBytes = 64 * 1024

    /// Per-connection frame cap: 5,000 frames. Chosen from the render side,
    /// not the memory side: a SwiftUI `List` of frame rows stays responsive
    /// well past this, and even 5,000 frames at the payload cap above is
    /// bounded to a few hundred MB worst case — in practice far less, since
    /// most WS traffic is small control/event messages. Past the cap,
    /// frames are still *counted* (surfaced to the user as a dropped count)
    /// but not stored; the receive loop and the connection are untouched by
    /// this cap, so a chatty server past 5,000 frames degrades to "console
    /// stopped growing," never to "connection dropped."
    public static let perConnectionFrameCount = 5000
}
