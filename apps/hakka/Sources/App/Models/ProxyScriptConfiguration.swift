import Foundation

/// An explicitly selected local JavaScript file for one proxy capture launch.
struct ProxyScriptConfiguration: Equatable {
    static let maximumSourceBytes = 256 * 1024

    var fileURL: URL?
    var source = ""
    /// Launch authorization is deliberately transient and is consumed by `prepareForLaunch()`.
    var isEnabledForNextLaunch = false

    var fileName: String { fileURL?.lastPathComponent ?? "No script selected" }

    mutating func load(from url: URL) throws {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true else { throw ProxyScriptConfigurationError.notAFile }
        guard (values.fileSize ?? 0) <= Self.maximumSourceBytes else { throw ProxyScriptConfigurationError.sourceTooLarge }
        let loaded = try String(contentsOf: url, encoding: .utf8)
        try Self.validate(loaded)
        fileURL = url
        source = loaded
        isEnabledForNextLaunch = false
    }

    func save() throws {
        guard let fileURL else { throw ProxyScriptConfigurationError.noFile }
        try Self.validate(source)
        let didAccess = fileURL.startAccessingSecurityScopedResource()
        defer { if didAccess { fileURL.stopAccessingSecurityScopedResource() } }
        try source.write(to: fileURL, atomically: true, encoding: .utf8)
    }

    /// Saves editor changes, returns the script path, and consumes this launch's authorization.
    mutating func prepareForLaunch() throws -> String? {
        guard isEnabledForNextLaunch else { return nil }
        isEnabledForNextLaunch = false
        try save()
        return fileURL?.path
    }

    static func validate(_ source: String) throws {
        guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProxyScriptConfigurationError.emptySource
        }
        guard source.lengthOfBytes(using: .utf8) <= maximumSourceBytes else {
            throw ProxyScriptConfigurationError.sourceTooLarge
        }
        guard source.contains("onRequest") || source.contains("onResponse") else {
            throw ProxyScriptConfigurationError.missingHook
        }
    }
}

enum ProxyScriptConfigurationError: LocalizedError, Equatable {
    case noFile, notAFile, emptySource, sourceTooLarge, missingHook

    var errorDescription: String? {
        switch self {
        case .noFile: "Choose a JavaScript file first."
        case .notAFile: "Choose a regular JavaScript file."
        case .emptySource: "The proxy script cannot be empty."
        case .sourceTooLarge: "The proxy script must be 256 KiB or smaller."
        case .missingHook: "Define onRequest(request), onResponse(response, request), or both."
        }
    }
}
