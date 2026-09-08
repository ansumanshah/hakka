import Foundation

struct ProxyStatusLine: Decodable, Sendable {
    struct Certificates: Decodable, Sendable {
        let configDir: String
        let publicCaPath: String?
        let publicCaExists: Bool
    }

    let status: String
    let host: String?
    let port: Int?
    let records: Int?
    let message: String?
    let certificates: Certificates?
}
