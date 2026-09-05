import HakkaCommon
import HakkaCore

/// Abstraction over the live-traffic store the traffic MCP tools read from.
/// `TrafficStore` conforms directly below — this protocol exists so
/// `MCPListRequestsTool`/`MCPGetRequestTool` are unit-testable against an
/// in-memory fake, with no actor, no bridge, and no capture pipeline
/// involved.
///
/// No redaction knob here, unlike `hakka mcp`'s `list_requests`/`get_request`
/// (`unredacted: true`): a `NetworkRequest` reaching `TrafficStore` has
/// already been through the connected app's own capture-time header/body
/// redaction (`HakkaInterceptor.redactHeaders`/`redactBodyFields` in
/// `ios/Sources/Network/Redaction.swift`, config-driven) before it ever left
/// the device — there is no "as captured, unredacted" version left on this
/// side to opt back into. `hakka mcp`'s flag exists because its *second*,
/// share-time scrub (`scrubRequestsForShare` in the `hakka-core` npm
/// package, pattern-matching for secret-shaped values beyond the
/// config-driven redaction) is optional and reversible; this store never
/// receives anything that scrub would have caught in the first place.
public protocol MCPTrafficSource: Sendable {
    /// Every captured request, oldest-first — same order as `TrafficStore.all()`.
    func allRequests() async -> [NetworkRequest]
    func request(id: String) async -> NetworkRequest?
}

extension TrafficStore: MCPTrafficSource {
    public func allRequests() async -> [NetworkRequest] { all() }
    // `request(id:)` already matches this protocol's signature exactly — a
    // synchronous actor-isolated method satisfies an `async` protocol
    // requirement because every caller outside the actor awaits it anyway —
    // so no forwarding override is needed here.
}
