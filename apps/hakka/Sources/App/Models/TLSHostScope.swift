import Foundation

enum TLSHostScopeMode: String, CaseIterable, Codable {
    case bypass
    case allowOnly

    var title: String {
        self == .bypass ? "Bypass TLS interception" : "Capture only these hosts"
    }
}

struct TLSHostScopeEntry: Codable, Identifiable, Equatable {
    var id = UUID()
    var host = ""
    var isEnabled = true
}

struct TLSHostScope: Codable, Equatable {
    static let maximumHostCount = 100
    static let maximumHostLength = 255

    var mode: TLSHostScopeMode = .bypass
    var entries: [TLSHostScopeEntry] = []

    var enabledHosts: [String] {
        enteredHosts.compactMap(Self.normalizedHost)
    }

    /// The CLI validates and escapes these literal entries before starting mitmproxy.
    var validationMessage: String? {
        if enteredHosts.count > Self.maximumHostCount {
            return "Use at most \(Self.maximumHostCount) TLS hosts."
        }
        if mode == .allowOnly, enteredHosts.isEmpty {
            return "Add at least one host before using capture-only mode."
        }
        for host in enteredHosts where Self.normalizedHost(host) == nil {
            return "Use a domain such as api.example.com, *.example.com, or api.example.com:443."
        }
        return nil
    }

    private var enteredHosts: [String] {
        entries.filter(\.isEnabled).map(\.host).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private static func normalizedHost(_ input: String) -> String? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard value.count <= maximumHostLength else { return nil }
        let withoutWildcard = value.hasPrefix("*.") ? String(value.dropFirst(2)) : value
        let parts = withoutWildcard.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count <= 2, let domain = parts.first, !domain.isEmpty else { return nil }
        let normalizedPort: String?
        if parts.count == 2 {
            let port = parts[1]
            guard port.unicodeScalars.allSatisfy({ $0.value >= 48 && $0.value <= 57 }),
                  let number = Int(port), (1 ... 65535).contains(number) else { return nil }
            normalizedPort = String(number)
        } else {
            normalizedPort = nil
        }
        guard domain.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({ label in
            let scalars = label.unicodeScalars
            guard let first = scalars.first, let last = scalars.last,
                  isASCIILetterOrDigit(first), isASCIILetterOrDigit(last) else { return false }
            return scalars.allSatisfy { isASCIILetterOrDigit($0) || $0.value == 45 }
        }) else { return nil }
        return "\(value.hasPrefix("*.") ? "*." : "")\(domain)\(normalizedPort.map { ":\($0)" } ?? "")"
    }

    private static func isASCIILetterOrDigit(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 48 ... 57, 97 ... 122: true
        default: false
        }
    }
}
