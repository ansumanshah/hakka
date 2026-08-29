import Foundation

/// Environments and `{{variable}}` resolution.
///
/// Two rules drive the design:
///
/// 1. **Secret values never enter the collection tree, and never sit in
///    plaintext on disk either.** A variable marked `secret` is stored
///    outside the collection directory (see `EnvironmentStore`), and its
///    *value* takes one further step into the macOS Keychain
///    (`SecretKeychainStore`) — the `.hakka` file next to it holds only a
///    reference token, resolved back on load. A committed collection can
///    reference `{{token}}` without the token, or even a pointer to it,
///    ever reaching a file a user might commit. This is why
///    `EnvironmentVariable` carries a `secret` flag instead of leaving it to
///    naming convention.
/// 2. **Resolution is total and reports failures.** An unresolved
///    `{{missing}}` is never silently sent as literal text — the runner shows
///    exactly which variables were missing, because a request that 404s
///    because a placeholder went out raw is a miserable thing to debug.
public struct RequestEnvironment: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var name: String
    public var variables: [EnvironmentVariable]

    public init(id: String = UUID().uuidString, name: String, variables: [EnvironmentVariable] = []) {
        self.id = id
        self.name = name
        self.variables = variables
    }

    public func value(for key: String) -> String? {
        variables.first { $0.name == key && $0.enabled }?.value
    }
}

public struct EnvironmentVariable: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var name: String
    public var value: String
    /// Secret values are redacted in logs/exports and stored outside the collection.
    public var secret: Bool
    public var enabled: Bool

    public init(
        id: String = UUID().uuidString,
        name: String,
        value: String,
        secret: Bool = false,
        enabled: Bool = true,
    ) {
        self.id = id
        self.name = name
        self.value = value
        self.secret = secret
        self.enabled = enabled
    }
}

/// The layered lookup a request sees at send time.
///
/// Precedence, lowest to highest: collection defaults < selected environment <
/// runtime values captured earlier in this run (`ResponseCapture`). Runtime
/// wins so a login step's captured token overrides a stale environment copy
/// without the user having to clear anything.
public struct VariableScope: Sendable, Equatable {
    public var collectionDefaults: [String: String]
    public var environment: [String: String]
    public var runtime: [String: String]

    public init(
        collectionDefaults: [String: String] = [:],
        environment: [String: String] = [:],
        runtime: [String: String] = [:],
    ) {
        self.collectionDefaults = collectionDefaults
        self.environment = environment
        self.runtime = runtime
    }

    public func value(for key: String) -> String? {
        runtime[key] ?? environment[key] ?? collectionDefaults[key]
    }

    public mutating func setRuntime(_ key: String, _ value: String) {
        runtime[key] = value
    }

    /// Every key visible across all three layers, collapsed to the same
    /// precedence `value(for:)` uses — collection defaults, then
    /// environment, then runtime, each overriding a same-named key from
    /// before it. Used to build the read-only `env` global a script sees
    /// (`RequestScriptHooks`): a script has no notion of layers, only one
    /// flat object.
    public var flattened: [String: String] {
        var result = collectionDefaults
        result.merge(environment) { _, new in new }
        result.merge(runtime) { _, new in new }
        return result
    }
}

/// The result of interpolating a template: the resolved text plus the names
/// that had no value. Callers decide whether missing names are fatal (the
/// runner refuses to send) or a warning (the editor shows them in red).
public struct Interpolation: Sendable, Equatable {
    public let text: String
    public let missing: [String]

    public var isComplete: Bool { missing.isEmpty }

    public init(text: String, missing: [String]) {
        self.text = text
        self.missing = missing
    }
}

public enum VariableInterpolator {
    /// Replace every `{{name}}` occurrence using `scope`.
    ///
    /// Deliberately NOT a general template language: no expressions, no
    /// function calls, no nested interpolation of resolved values. A resolved
    /// value that itself contains `{{x}}` is left alone, which makes
    /// resolution single-pass, non-recursive, and immune to the
    /// self-referential loop (`a = {{b}}`, `b = {{a}}`) that a naive
    /// re-scanning implementation hangs on.
    ///
    /// Whitespace inside the braces is tolerated (`{{ token }}`), because
    /// every other client tolerates it and users paste from those.
    public static func interpolate(_ template: String, scope: VariableScope) -> Interpolation {
        guard template.contains("{{") else { return Interpolation(text: template, missing: []) }

        var out = String()
        out.reserveCapacity(template.count)
        var missing: [String] = []
        var rest = Substring(template)

        while let open = rest.range(of: "{{") {
            out += rest[rest.startIndex ..< open.lowerBound]
            let afterOpen = rest[open.upperBound...]
            guard let close = afterOpen.range(of: "}}") else {
                // Unterminated `{{` — emit the rest verbatim rather than
                // dropping it; a half-typed placeholder in the editor must
                // still round-trip through the preview unchanged.
                out += rest[open.lowerBound...]
                return Interpolation(text: out, missing: missing)
            }
            let rawName = afterOpen[afterOpen.startIndex ..< close.lowerBound]
            let name = rawName.trimmingCharacters(in: .whitespaces)
            if let value = scope.value(for: name) {
                out += value
            } else {
                missing.append(name)
                // Keep the placeholder visible in the output so the user sees
                // what would have been sent.
                out += "{{\(name)}}"
            }
            rest = afterOpen[close.upperBound...]
        }
        out += rest
        return Interpolation(text: out, missing: missing)
    }

    /// Every `{{name}}` referenced by a template, in first-appearance order,
    /// deduplicated. Used by the editor to show a request's variable
    /// dependencies before it runs.
    public static func references(in template: String) -> [String] {
        var names: [String] = []
        var seen = Set<String>()
        var rest = Substring(template)
        while let open = rest.range(of: "{{") {
            let afterOpen = rest[open.upperBound...]
            guard let close = afterOpen.range(of: "}}") else { break }
            let name = afterOpen[afterOpen.startIndex ..< close.lowerBound].trimmingCharacters(in: .whitespaces)
            if !name.isEmpty, seen.insert(name).inserted { names.append(name) }
            rest = afterOpen[close.upperBound...]
        }
        return names
    }
}
