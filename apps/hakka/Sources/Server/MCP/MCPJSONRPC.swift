import Foundation

/// JSON-RPC 2.0 error codes this server can return — the pre-defined range
/// from the spec (https://www.jsonrpc.org/specification#error_object).
/// `-32000...-32099` is reserved for implementation-defined server errors;
/// this server has no need for one yet, so only the five standard codes are
/// used.
public enum MCPErrorCode {
    /// Invalid JSON was received — a syntax error, not a shape problem.
    public static let parseError = -32700
    /// The JSON parsed fine but isn't a valid JSON-RPC Request object
    /// (missing/wrong `jsonrpc`, missing/non-string `method`, ...).
    public static let invalidRequest = -32600
    /// `method` doesn't name one this server implements.
    public static let methodNotFound = -32601
    /// The method is known but `params` (for `tools/call`: an unknown tool
    /// name, or a `name` field of the wrong type) doesn't satisfy it. A
    /// *tool's own* argument validation failure is deliberately NOT this —
    /// see `MCPRequestHandler`'s `tools/call` handling for why.
    public static let invalidParams = -32602
    /// Anything else that goes wrong on this server's side of the call.
    public static let internalError = -32603
}

/// One parsed JSON-RPC 2.0 request, decoded leniently enough to always
/// distinguish "invalid JSON" (`nil`) from "valid JSON that isn't a valid
/// Request object" (a non-`nil` result whose `isValidRequest` is `false`) —
/// the two cases the spec gives different error codes for.
struct MCPParsedRequest {
    /// Every field found in the request's top-level object, or empty if the
    /// body wasn't even a JSON object (e.g. a bare array or scalar).
    let fields: [String: MCPValue]
    let jsonrpc: String?
    let method: String?
    /// `.null` when the field was absent from the JSON — same as an
    /// explicit `"id": null`. `MCPRequestHandler` treats an absent `id` as
    /// marking a notification (no response expected) via `isNotification`,
    /// not via this being `.null`.
    let id: MCPValue
    let params: MCPValue
    let isNotification: Bool

    var isValidRequest: Bool {
        jsonrpc == "2.0" && method?.isEmpty == false
    }

    /// `nil` only for a genuine JSON syntax error — anything that parses as
    /// *some* JSON value, even a malformed Request shape, still returns a
    /// (possibly `isValidRequest == false`) result.
    static func parse(_ body: Data) -> MCPParsedRequest? {
        guard let root = try? JSONDecoder().decode(MCPValue.self, from: body) else { return nil }
        let fields: [String: MCPValue]
        if case let .object(f) = root {
            fields = f
        } else {
            fields = [:]
        }
        return MCPParsedRequest(
            fields: fields,
            jsonrpc: fields["jsonrpc"]?.stringValue,
            method: fields["method"]?.stringValue,
            id: fields["id"] ?? .null,
            params: fields["params"] ?? .object([:]),
            isNotification: fields["id"] == nil
        )
    }
}

/// Builds JSON-RPC 2.0 response bodies. Free functions rather than a type —
/// there is no state, just two shapes to assemble.
enum MCPResponseBuilder {
    static func success(id: MCPValue, result: MCPValue) -> Data {
        MCPValue.object(["jsonrpc": .string("2.0"), "id": id, "result": result]).jsonData()
    }

    static func failure(id: MCPValue, code: Int, message: String, data: MCPValue? = nil) -> Data {
        var errorFields: [String: MCPValue] = ["code": .number(Double(code)), "message": .string(message)]
        if let data { errorFields["data"] = data }
        return MCPValue.object(["jsonrpc": .string("2.0"), "id": id, "error": .object(errorFields)]).jsonData()
    }
}
