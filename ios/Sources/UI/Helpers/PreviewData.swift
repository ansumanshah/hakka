#if canImport(UIKit)
import Foundation
import HakkaCommon
import HakkaNetwork

#if DEBUG
/// Mock data for SwiftUI `#Preview` blocks. Stripped from release builds.
enum PreviewData {
    private static let now = Int64(Date().timeIntervalSince1970 * 1000)

    static let get200 = NetworkRequest(
        id: "p1", url: "https://api.example.com/users?page=1&limit=20",
        method: .get, status: 200, startTime: now - 5000, duration: 142,
        requestHeaders: ["Accept": ["application/json"]],
        responseHeaders: ["Content-Type": ["application/json"], "Cache-Control": ["no-cache"]],
        responseBodySize: 2048,
        responseBody: """
        {"users":[{"id":1,"name":"Alice","email":"alice@example.com"},{"id":2,"name":"Bob","email":"bob@example.com"}],"total":42}
        """,
        source: .urlSession, dnsMs: 12, tlsMs: 25, connectMs: 18, ttfbMs: 65, downloadMs: 22,
        tlsVersion: "TLSv1.3", networkProtocol: "h2"
    )

    static let post201 = NetworkRequest(
        id: "p2", url: "https://api.example.com/users",
        method: .post, status: 201, startTime: now - 4000, duration: 230,
        requestHeaders: ["Content-Type": ["application/json"], "Authorization": ["[REDACTED]"]],
        responseHeaders: ["Content-Type": ["application/json"]],
        requestBodySize: 86, responseBodySize: 124,
        requestBody: "{\"name\":\"Charlie\",\"email\":\"charlie@example.com\"}",
        responseBody: "{\"id\":3,\"name\":\"Charlie\",\"created\":true}"
    )

    static let get404 = NetworkRequest(
        id: "p3", url: "https://api.example.com/users/999",
        method: .get, status: 404, startTime: now - 3000, duration: 89,
        responseHeaders: ["Content-Type": ["application/json"]],
        responseBodySize: 42,
        responseBody: "{\"error\":\"Not Found\",\"message\":\"User 999 does not exist\"}"
    )

    static let get500 = NetworkRequest(
        id: "p4", url: "https://api.example.com/health",
        method: .get, status: 500, startTime: now - 2000, duration: 1250,
        responseBody: "{\"error\":\"Internal Server Error\"}"
    )

    static let dnsError = NetworkRequest(
        id: "p5", url: "https://nonexistent.invalid/api",
        method: .get, startTime: now - 1500, duration: 3200,
        error: "A server with the specified hostname could not be found."
    )

    static let redirect = NetworkRequest(
        id: "p6", url: "https://example.com/final",
        method: .get, status: 200, startTime: now - 1000, duration: 420,
        redirectCount: 3,
        redirectUrls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"]
    )

    static let slow = NetworkRequest(
        id: "p7", url: "https://httpbin.org/delay/3",
        method: .get, status: 200, startTime: now - 500, duration: 3150,
        requestHeaders: ["Accept": ["application/json"]],
        responseHeaders: ["Content-Type": ["application/json"], "X-Processed-Time": ["3.048"]],
        responseBodySize: 4096,
        responseBody: "{\"origin\":\"1.2.3.4\"}",
        dnsMs: 5, tlsMs: 30, connectMs: 15, ttfbMs: 3050, downloadMs: 50,
        tlsVersion: "TLSv1.3", cipherSuite: "TLS_AES_256_GCM_SHA384", networkProtocol: "h2"
    )

    static let delete204 = NetworkRequest(
        id: "p8", url: "https://api.example.com/users/3",
        method: .delete, status: 204, startTime: now - 300, duration: 95
    )

    static let pending = NetworkRequest(
        id: "p9", url: "https://api.example.com/long-poll",
        method: .get, startTime: now
    )

    static let batch: [NetworkRequest] = [
        get200, post201, get404, get500, dnsError, redirect, slow, delete204, pending,
    ]
}
#endif
#endif // canImport(UIKit)
