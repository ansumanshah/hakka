import Foundation

/// Failures `RequestResolver` can report. Both are refusals to build a plan
/// at all — the caller never gets a `ResolvedRequest` that would send a
/// literal `{{token}}` or a malformed URL.
public enum RequestResolutionError: Error, Equatable, Sendable {
    /// `{{name}}` references with no value anywhere in the scope.
    /// Deduplicated, first-appearance order.
    case missingVariables([String])
    /// The fully interpolated URL string was not a valid URL.
    case invalidURL(String)
}
