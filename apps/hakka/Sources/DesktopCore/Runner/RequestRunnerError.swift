import Foundation

/// Failures that stop a run before any bytes go on the wire. Once a
/// `URLRequest` is built, a network failure is recorded as `record.error` in
/// the returned `RunResult` instead of being thrown — see `RequestRunner`.
public enum RequestRunnerError: Error, Equatable, Sendable {
    case resolution(RequestResolutionError)
    case bodyEncoding(RequestBodyEncodingError)
}
