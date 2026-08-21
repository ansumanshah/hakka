import Foundation

/// The RFC 6749 §5 token response shape, shared by every grant this file
/// runs. Field names are the wire's snake_case, mapped explicitly rather
/// than via a decoder-wide `.convertFromSnakeCase` strategy so this type's
/// `CodingKeys` stay the single source of truth for what the wire sends.
struct OAuth2TokenEndpointResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let expiresIn: Double?
    let error: String?
    let errorDescription: String?

    private enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case error
        case errorDescription = "error_description"
    }

    /// Parses `body` and turns a §5.2 error response into a thrown
    /// `OAuth2FlowError` rather than a value the caller has to remember to
    /// check — the whole point being that a caller who forgets to check
    /// `error` can't accidentally treat an error response as a token.
    static func parse(status: Int, body: Data) throws(OAuth2FlowError) -> OAuth2TokenEndpointResponse {
        guard let response = try? JSONDecoder().decode(OAuth2TokenEndpointResponse.self, from: body) else {
            if status >= 300 {
                let text = String(data: body, encoding: .utf8) ?? ""
                throw .tokenEndpointHTTPError(status: status, body: text)
            }
            throw .malformedTokenResponse
        }
        if let error = response.error {
            throw .tokenEndpointError(code: error, description: response.errorDescription)
        }
        guard status < 300 else {
            throw .tokenEndpointHTTPError(status: status, body: String(data: body, encoding: .utf8) ?? "")
        }
        guard response.accessToken != nil else {
            throw .malformedTokenResponse
        }
        return response
    }
}
