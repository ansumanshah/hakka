import Foundation
import Observation

@MainActor
@Observable
final class ProxyUpstream {
    enum ValidationError: LocalizedError, Equatable {
        case invalidURL
        case unsupportedScheme
        case missingHost
        case credentials
        case path
        case queryOrFragment
        case tooLong
        case missingPort
        case invalidPort

        var errorDescription: String? {
            switch self {
            case .invalidURL: "Enter an HTTP(S) upstream proxy URL with an explicit port."
            case .unsupportedScheme: "The upstream proxy must use http:// or https://."
            case .missingHost: "The upstream proxy must include a host."
            case .credentials: "Upstream proxy credentials are not supported."
            case .path: "The upstream proxy URL must not include a path."
            case .queryOrFragment: "The upstream proxy URL must not include a query or fragment."
            case .tooLong: "The upstream proxy URL must be at most 2048 characters."
            case .missingPort: "The upstream proxy requires an explicit port between 1 and 65535."
            case .invalidPort: "The upstream proxy port must be an integer between 1 and 65535."
            }
        }
    }

    private static let key = "hakka.proxy.upstreamURL"
    private static let maximumURLLength = 2_048
    private let defaults: UserDefaults
    var url: String

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        url = defaults.string(forKey: Self.key) ?? ""
    }

    func persist() {
        let value = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { defaults.removeObject(forKey: Self.key) }
        else { defaults.set(value, forKey: Self.key) }
    }

    func reset() {
        url = ""
        defaults.removeObject(forKey: Self.key)
    }

    func cliArguments() -> Result<[String], ValidationError> {
        let value = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return .success([]) }
        guard value.count <= Self.maximumURLLength else { return .failure(.tooLong) }
        guard !value.contains("?") && !value.contains("#") else { return .failure(.queryOrFragment) }
        guard !value.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.contains($0) }) else { return .failure(.invalidURL) }
        guard let schemeRange = value.range(of: "://") else { return .failure(.invalidURL) }
        let suffix = value[schemeRange.upperBound...]
        let slash = suffix.firstIndex(of: "/")
        let authority = slash.map { suffix[..<$0] } ?? suffix
        let rawPath = slash.map { String(suffix[$0...]) } ?? ""
        guard rawPath.isEmpty || rawPath == "/" else { return .failure(.path) }
        guard let components = URLComponents(string: value) else { return .failure(.invalidURL) }
        guard let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return .failure(.unsupportedScheme) }
        guard let host = components.host, !host.isEmpty else { return .failure(.missingHost) }
        guard components.user == nil && components.password == nil else { return .failure(.credentials) }
        guard components.path.isEmpty || components.path == "/" else { return .failure(.path) }
        guard let portText = explicitPort(in: authority) else { return .failure(.missingPort) }
        guard portText.unicodeScalars.allSatisfy({ (48...57).contains($0.value) }), let port = Int(portText) else { return .failure(.invalidPort) }
        guard (1...65_535).contains(port) else { return .failure(.invalidPort) }
        let renderedHost = host
        return .success(["--upstream-proxy", "\(scheme)://\(renderedHost):\(port)"])
    }

    private func explicitPort(in authority: Substring) -> String? {
        guard let colon = authority.lastIndex(of: ":") else { return nil }
        let portText = authority[authority.index(after: colon)...]
        guard !portText.isEmpty else { return nil }
        return String(portText)
    }
}
