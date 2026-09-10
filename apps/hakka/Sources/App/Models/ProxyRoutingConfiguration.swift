import Foundation
import Observation

@MainActor
@Observable
final class ProxyRoutingConfiguration {
    enum Mode: String, CaseIterable, Identifiable {
        case direct
        case upstream
        case pac

        var id: String {
            rawValue
        }
    }

    enum PACSource: String, CaseIterable, Identifiable {
        case file
        case url

        var id: String {
            rawValue
        }
    }

    enum ValidationError: LocalizedError, Equatable {
        case invalidProxyURL
        case missingProxyPort
        case proxyCredentialsInURL
        case incompleteAuthentication
        case invalidUsername
        case missingPACSource
        case invalidPACURL
        case valueTooLong

        var errorDescription: String? {
            switch self {
            case .invalidProxyURL: "Enter an HTTP(S) proxy URL containing only its host and port."
            case .missingProxyPort: "The proxy URL requires an explicit port between 1 and 65535."
            case .proxyCredentialsInURL: "Enter proxy credentials in the username and password fields."
            case .incompleteAuthentication: "Enter both a proxy username and password, or leave both empty."
            case .invalidUsername: "The proxy username must not contain a colon."
            case .missingPACSource: "Choose an explicit PAC file or URL."
            case .invalidPACURL: "The PAC URL must use HTTP or HTTPS and must not contain credentials or a fragment."
            case .valueTooLong: "The routing configuration contains a value that is too long."
            }
        }
    }

    private struct AuthenticationPayload: Encodable {
        let username: String
        let password: String
    }

    private struct EndpointPayload: Encodable {
        let url: String
        let authentication: AuthenticationPayload?
    }

    private struct PACPayload: Encodable {
        let file: String?
        let url: String?
    }

    private struct Payload: Encodable {
        let version = 1
        let mode: String
        let upstream: EndpointPayload?
        let pac: PACPayload?
        let authentication: [EndpointPayload]?
    }

    private static let modeKey = "hakka.proxy.routing.mode"
    private static let proxyURLKey = "hakka.proxy.routing.proxyURL"
    private static let pacSourceKey = "hakka.proxy.routing.pacSource"
    private static let pacValueKey = "hakka.proxy.routing.pacValue"
    private let defaults: UserDefaults

    var mode: Mode
    var proxyURL: String
    var username = ""
    var password = ""
    var pacSource: PACSource
    var pacValue: String

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        mode = Mode(rawValue: defaults.string(forKey: Self.modeKey) ?? "") ?? .direct
        proxyURL = defaults.string(forKey: Self.proxyURLKey) ?? ""
        pacSource = PACSource(rawValue: defaults.string(forKey: Self.pacSourceKey) ?? "") ?? .file
        pacValue = defaults.string(forKey: Self.pacValueKey) ?? ""
    }

    func persistNonSensitiveSettings() {
        defaults.set(mode.rawValue, forKey: Self.modeKey)
        setOrRemove(proxyURL.trimmingCharacters(in: .whitespacesAndNewlines), key: Self.proxyURLKey)
        defaults.set(pacSource.rawValue, forKey: Self.pacSourceKey)
        setOrRemove(pacValue.trimmingCharacters(in: .whitespacesAndNewlines), key: Self.pacValueKey)
    }

    func clearCredentials() {
        username = ""
        password = ""
    }

    func configurationData() -> Result<Data, ValidationError> {
        do {
            let payload: Payload
            switch mode {
            case .direct:
                payload = Payload(mode: mode.rawValue, upstream: nil, pac: nil, authentication: nil)
            case .upstream:
                let endpoint = try validatedEndpoint()
                guard let endpoint else { return .failure(.invalidProxyURL) }
                payload = Payload(mode: mode.rawValue, upstream: endpoint, pac: nil, authentication: nil)
            case .pac:
                let source = pacValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !source.isEmpty else { return .failure(.missingPACSource) }
                guard source.count <= 4096 else { return .failure(.valueTooLong) }
                let pac: PACPayload
                if pacSource == .url {
                    guard let components = URLComponents(string: source),
                          let scheme = components.scheme?.lowercased(),
                          scheme == "http" || scheme == "https",
                          components.host?.isEmpty == false,
                          components.user == nil,
                          components.password == nil,
                          components.fragment == nil
                    else { return .failure(.invalidPACURL) }
                    pac = PACPayload(file: nil, url: source)
                } else {
                    pac = PACPayload(file: source, url: nil)
                }
                let endpoint = try validatedEndpoint()
                payload = Payload(mode: mode.rawValue, upstream: nil, pac: pac, authentication: endpoint.map { [$0] })
            }
            return try .success(JSONEncoder().encode(payload))
        } catch let error as ValidationError {
            return .failure(error)
        } catch {
            return .failure(.invalidProxyURL)
        }
    }

    func writeConfiguration(to url: URL) throws {
        let data: Data
        switch configurationData() {
        case let .success(value): data = value
        case let .failure(error): throw error
        }
        let manager = FileManager.default
        let directory = url.deletingLastPathComponent()
        try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = directory.appendingPathComponent(".routing-\(UUID().uuidString).json")
        guard manager.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        defer { try? manager.removeItem(at: temporary) }
        let handle = try FileHandle(forWritingTo: temporary)
        try handle.write(contentsOf: data)
        try handle.synchronize()
        try handle.close()
        if manager.fileExists(atPath: url.path) {
            _ = try manager.replaceItemAt(url, withItemAt: temporary)
        } else {
            try manager.moveItem(at: temporary, to: url)
        }
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        persistNonSensitiveSettings()
    }

    private func validatedEndpoint() throws -> EndpointPayload? {
        let value = proxyURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = username
        let secret = password
        if value.isEmpty {
            if !user.isEmpty || !secret.isEmpty {
                throw ValidationError.incompleteAuthentication
            }
            return nil
        }
        guard value.count <= 2048, user.count <= 1024, secret.count <= 8192 else { throw ValidationError.valueTooLong }
        guard let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host,
              !host.isEmpty,
              components.path.isEmpty || components.path == "/",
              components.query == nil,
              components.fragment == nil
        else { throw ValidationError.invalidProxyURL }
        guard components.user == nil, components.password == nil else { throw ValidationError.proxyCredentialsInURL }
        guard let port = components.port, (1 ... 65535).contains(port) else { throw ValidationError.missingProxyPort }
        guard user.isEmpty == secret.isEmpty else { throw ValidationError.incompleteAuthentication }
        guard !user.contains(":") else { throw ValidationError.invalidUsername }
        let renderedHost = host.contains(":") ? "[\(host)]" : host
        let authentication = user.isEmpty ? nil : AuthenticationPayload(username: user, password: secret)
        return EndpointPayload(url: "\(scheme)://\(renderedHost):\(port)", authentication: authentication)
    }

    private func setOrRemove(_ value: String, key: String) {
        if value.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(value, forKey: key)
        }
    }
}
