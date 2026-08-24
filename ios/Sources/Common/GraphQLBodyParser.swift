import Foundation

// MARK: - GraphQL Body Parser

/// Extracts GraphQL operation type, variables, and response errors from raw JSON strings.
/// Parsing is done at display-time — no additional fields are added to `NetworkRequest`.
public enum GraphQLBodyParser {

    // MARK: - Types

    public struct GraphQLBodyInfo {
        public let operationType: String
        public let query: String?
        public let variablesJSON: String?
    }

    public struct GraphQLResponseError {
        public let message: String
        public let path: String?
    }

    // MARK: - Request body parsing

    /// Parse operation type and pretty-printed variables from a GraphQL request body.
    /// Returns `nil` for non-JSON or non-GraphQL bodies.
    public static func parse(_ body: String?) -> GraphQLBodyInfo? {
        guard let body, !body.isEmpty,
              !JSONDepthGuard.exceedsDepthLimit(body, limit: maxParseDepth),
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        // Detect operation type from the `query` field keyword
        let query = json["query"] as? String
        let operationType: String
        if let query {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if trimmed.hasPrefix("mutation") {
                operationType = "mutation"
            } else if trimmed.hasPrefix("subscription") {
                operationType = "subscription"
            } else {
                operationType = "query"
            }
        } else {
            operationType = "query"
        }

        // Pretty-print variables if present and non-empty
        var variablesJSON: String?
        if let vars = json["variables"] as? [String: Any], !vars.isEmpty,
           let varData = try? JSONSerialization.data(withJSONObject: vars, options: [.prettyPrinted, .sortedKeys]) {
            variablesJSON = String(data: varData, encoding: .utf8)
        }

        return GraphQLBodyInfo(operationType: operationType, query: query, variablesJSON: variablesJSON)
    }

    // MARK: - Response body error parsing

    /// Extract the `errors` array from a GraphQL response body.
    public static func parseErrors(_ responseBody: String?) -> [GraphQLResponseError] {
        guard let body = responseBody, !body.isEmpty,
              !JSONDepthGuard.exceedsDepthLimit(body, limit: maxParseDepth),
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let errors = json["errors"] as? [[String: Any]] else {
            return []
        }
        return errors.compactMap { dict -> GraphQLResponseError? in
            guard let message = dict["message"] as? String else { return nil }
            var path: String? = nil
            if let pathArr = dict["path"] as? [Any], !pathArr.isEmpty {
                path = pathArr.map { "\($0)" }.joined(separator: ".")
            }
            return GraphQLResponseError(message: message, path: path)
        }
    }

    // MARK: - Depth guard

    /// Matches Redaction.swift's `maxRedactionDepth`. `JSONDepthGuard` (shared
    /// scanner) is checked before parsing, not after — this runs on the main
    /// thread when a stored body is opened for display.
    private static let maxParseDepth = 100
}
