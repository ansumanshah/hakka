import Foundation

/// Everything that can stop an OAuth2 flow before it produces a token.
/// Every case is surfaced to the caller as a message — none of these are
/// swallowed or downgraded to a silent "no token" outcome, because a user
/// staring at a spinner with no explanation is worse than an error.
public enum OAuth2FlowError: Error, Equatable, Sendable {
    /// The system browser reported it couldn't be opened.
    case browserLaunchFailed
    /// No redirect arrived before `timeout` elapsed. The loopback listener
    /// is guaranteed to have released its port by the time this throws.
    case callbackTimedOut
    /// The user canceled the flow (closed the window, dismissed the sheet)
    /// before a redirect arrived.
    case cancelled
    /// The redirect landed but carried an OAuth2 `error` parameter — the
    /// provider is telling us the authorization itself failed (consent
    /// denied, invalid client, etc.), not that our plumbing broke.
    case authorizationDenied(code: String, description: String?)
    /// The redirect's `state` didn't match the one this flow generated.
    /// Never a warning: a mismatch here is exactly the CSRF the `state`
    /// parameter exists to catch, so the callback is rejected outright.
    case stateMismatch
    /// The redirect had no `code` parameter and no `error` parameter either
    /// — a malformed or unexpected callback.
    case missingAuthorizationCode
    /// The token endpoint returned a non-2xx status.
    case tokenEndpointHTTPError(status: Int, body: String)
    /// The token endpoint returned 2xx but its own JSON `error` field is set.
    case tokenEndpointError(code: String, description: String?)
    /// The token endpoint's response body couldn't be parsed as the
    /// expected token JSON shape.
    case malformedTokenResponse
    /// A grant that needs a refresh token (the refresh-token grant, or a
    /// refresh triggered by expiry) had none available.
    case noRefreshTokenAvailable
    case transport(String)
}
