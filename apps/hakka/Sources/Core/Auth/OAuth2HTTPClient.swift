import Foundation

/// One token-endpoint request: a form-encoded POST, the shape every grant
/// in this file sends (RFC 6749 §4.x). Kept as a plain struct rather than
/// `URLRequest` so tests can assert on `parameters` without touching
/// `Foundation.URLRequest`'s header-ordering quirks.
public struct OAuth2TokenHTTPRequest: Sendable, Equatable {
    public let url: String
    public let parameters: [String: String]

    public init(url: String, parameters: [String: String]) {
        self.url = url
        self.parameters = parameters
    }
}

public struct OAuth2TokenHTTPResponse: Sendable, Equatable {
    public let status: Int
    public let body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

/// The seam between `OAuth2FlowRunner` and the network. Real requests go
/// through `URLSessionOAuth2HTTPClient`; tests inject a fake that never
/// touches a socket, which is how "no network in tests" is enforced for the
/// token exchange step.
public protocol OAuth2HTTPClient: Sendable {
    func send(_ request: OAuth2TokenHTTPRequest) async throws -> OAuth2TokenHTTPResponse
}

public struct URLSessionOAuth2HTTPClient: OAuth2HTTPClient {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: OAuth2TokenHTTPRequest) async throws -> OAuth2TokenHTTPResponse {
        guard let url = URL(string: request.url) else {
            throw OAuth2FlowError.transport("invalid token URL")
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.httpBody = Self.formEncode(request.parameters)

        do {
            let (data, response) = try await session.data(for: urlRequest)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return OAuth2TokenHTTPResponse(status: status, body: data)
        } catch {
            throw OAuth2FlowError.transport(error.localizedDescription)
        }
    }

    private static func formEncode(_ parameters: [String: String]) -> Data {
        let pairs = parameters.sorted { $0.key < $1.key }.map { key, value in
            "\(URLQuerySplitter.encode(key))=\(URLQuerySplitter.encode(value))"
        }
        return Data(pairs.joined(separator: "&").utf8)
    }
}
