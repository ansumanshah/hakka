import Foundation

/// Closed error set for every importer in this directory — "this input
/// doesn't parse" only ever needs a reason string, not a taxonomy.
public enum ImportError: Error, Sendable, Equatable {
    case emptyInput
    case invalidJSON(String)
    case missingField(String)
    case unsupportedFormat(String)
}
