import Foundation

/// Casting helpers for navigating `JSONSerialization` output, which types
/// everything as `Any`. Used instead of `Codable` because Postman/OpenAPI/HAR
/// documents have too many optional shape variations (string-or-object URL,
/// per-mode body fields) for a fixed `Decodable` type to tolerate gracefully.
extension [String: Any] {
    func string(_ key: String) -> String? { self[key] as? String }
    func dict(_ key: String) -> [String: Any]? { self[key] as? [String: Any] }
    func array(_ key: String) -> [[String: Any]]? { self[key] as? [[String: Any]] }
    func bool(_ key: String) -> Bool? { self[key] as? Bool }
}

enum JSONParsing {
    static func object(from data: Data) throws(ImportError) -> [String: Any] {
        guard !data.isEmpty else { throw ImportError.emptyInput }
        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw ImportError.invalidJSON(error.localizedDescription)
        }
        guard let object = parsed as? [String: Any] else {
            throw ImportError.invalidJSON("root is not a JSON object")
        }
        return object
    }
}
