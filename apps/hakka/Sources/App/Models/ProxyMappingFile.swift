import Foundation

struct ProxyLocalMapping: Codable, Identifiable {
    var id = UUID()
    var match = ""
    var file = ""
    enum CodingKeys: String, CodingKey { case match, file }
}

struct ProxyRemoteMapping: Codable, Identifiable {
    var id = UUID()
    var match = ""
    var replace = ""
    enum CodingKeys: String, CodingKey { case match, replace }
}

struct ProxyHeaderRule: Codable, Identifiable {
    enum Phase: String, Codable, CaseIterable, Identifiable {
        case request, response
        var id: Self { self }
    }
    enum Operation: String, Codable, CaseIterable, Identifiable {
        case set, remove
        var id: Self { self }
    }

    var id = UUID()
    var match = ""
    var phase = Phase.request
    var operation = Operation.set
    var name = ""
    var value = ""
    enum CodingKeys: String, CodingKey { case match, phase, operation, name, value }
}

struct ProxyBlockRule: Codable, Identifiable {
    var id = UUID()
    var match = ""
    var status = 403
    var body = "Blocked by a local Hakka proxy rule."
    enum CodingKeys: String, CodingKey { case match, status, body }
}

struct ProxyDelayRule: Codable, Identifiable {
    var id = UUID()
    var match = ""
    var phase = ProxyHeaderRule.Phase.request
    var delayMs = 0
    enum CodingKeys: String, CodingKey { case match, phase, delayMs }
}

struct ProxyMappingFile: Codable {
    var mapLocal: [ProxyLocalMapping] = []
    var mapRemote: [ProxyRemoteMapping] = []
    var headerRules: [ProxyHeaderRule] = []
    var blockRules: [ProxyBlockRule] = []
    var delayRules: [ProxyDelayRule] = []

    enum CodingKeys: String, CodingKey { case mapLocal, mapRemote, headerRules, blockRules, delayRules }

    init(mapLocal: [ProxyLocalMapping] = [], mapRemote: [ProxyRemoteMapping] = [], headerRules: [ProxyHeaderRule] = [], blockRules: [ProxyBlockRule] = [], delayRules: [ProxyDelayRule] = []) {
        self.mapLocal = mapLocal
        self.mapRemote = mapRemote
        self.headerRules = headerRules
        self.blockRules = blockRules
        self.delayRules = delayRules
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        mapLocal = try values.decodeIfPresent([ProxyLocalMapping].self, forKey: .mapLocal) ?? []
        mapRemote = try values.decodeIfPresent([ProxyRemoteMapping].self, forKey: .mapRemote) ?? []
        headerRules = try values.decodeIfPresent([ProxyHeaderRule].self, forKey: .headerRules) ?? []
        blockRules = try values.decodeIfPresent([ProxyBlockRule].self, forKey: .blockRules) ?? []
        delayRules = try values.decodeIfPresent([ProxyDelayRule].self, forKey: .delayRules) ?? []
    }

    func write(to url: URL) throws {
        for rule in mapLocal {
            try validateExpression(rule.match)
            let values = try URL(fileURLWithPath: rule.file).resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true else { throw ProxyMappingError.notAFile }
        }
        for rule in mapRemote {
            try validateExpression(rule.match)
            guard !rule.replace.isEmpty else { throw ProxyMappingError.emptyReplacement }
        }
        for rule in headerRules {
            try validateExpression(rule.match)
            let name = rule.name
            guard Self.isValidHeaderName(name) else { throw ProxyMappingError.invalidHeaderName }
            if rule.operation == .set, Self.hasForbiddenHeaderValueCharacter(rule.value) {
                throw ProxyMappingError.invalidHeaderValue
            }
        }
        for rule in blockRules {
            try validateExpression(rule.match)
            guard (400...599).contains(rule.status) else { throw ProxyMappingError.invalidBlockStatus }
            guard rule.body.lengthOfBytes(using: .utf8) <= 16 * 1024 else { throw ProxyMappingError.blockBodyTooLarge }
        }
        for rule in delayRules {
            try validateExpression(rule.match)
            guard (0...30_000).contains(rule.delayMs) else { throw ProxyMappingError.invalidDelay }
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(self).write(to: url, options: .atomic)
    }

    private func validateExpression(_ expression: String) throws {
        guard !expression.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ProxyMappingError.emptyExpression }
        guard Self.usesPortableExpressionSyntax(expression) else { throw ProxyMappingError.invalidExpression }
        do { _ = try NSRegularExpression(pattern: expression) }
        catch { throw ProxyMappingError.invalidExpression }
    }

    /// The persisted file is also compiled by JavaScript and Python `re`.
    private static func usesPortableExpressionSyntax(_ expression: String) -> Bool {
        let characters = Array(expression)
        var index = 0
        var inCharacterClass = false
        var characterClassHasMember = false
        while index < characters.count {
            let character = characters[index]
            if character == "\\" {
                guard index + 1 < characters.count else { return true }
                let escaped = characters[index + 1]
                if !"dDsSwWbBfnrtv\\.^$|?*+()[]{}-/".contains(escaped) { return false }
                if inCharacterClass && escaped == "B" { return false }
                if inCharacterClass { characterClassHasMember = true }
                index += 2
                continue
            }
            if character == "[" && !inCharacterClass {
                inCharacterClass = true
                characterClassHasMember = false
                index += 1
                continue
            }
            if character == "]" && inCharacterClass {
                if !characterClassHasMember { return false }
                inCharacterClass = false
                index += 1
                continue
            }
            if inCharacterClass {
                if !(character == "^" && !characterClassHasMember) { characterClassHasMember = true }
                index += 1
                continue
            }
            if character == "(" && index + 1 < characters.count && characters[index + 1] == "?" {
                guard index + 2 < characters.count, characters[index + 2] == ":" else { return false }
            }
            index += 1
        }
        return true
    }

    private static func isValidHeaderName(_ name: String) -> Bool {
        let allowed = CharacterSet(charactersIn: "!#$%&'*+-.^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
        return !name.isEmpty && name.unicodeScalars.allSatisfy { $0.value < 128 && allowed.contains($0) }
    }

    private static func hasForbiddenHeaderValueCharacter(_ value: String) -> Bool {
        value.unicodeScalars.contains { scalar in
            scalar.value <= 8 || (10...31).contains(scalar.value) || scalar.value == 127
        }
    }
}

private enum ProxyMappingError: LocalizedError {
    case emptyExpression, invalidExpression, notAFile, emptyReplacement, invalidHeaderName, invalidHeaderValue, invalidBlockStatus, blockBodyTooLarge, invalidDelay
    var errorDescription: String? {
        switch self {
        case .emptyExpression: "Enter a URL expression for every mapping."
        case .invalidExpression: "Use portable URL regex: literals, classes, groups, quantifiers, anchors, and alternation; no lookaround, named groups, backreferences, inline flags, or Unicode properties."
        case .notAFile: "Choose a regular file for each local response."
        case .emptyReplacement: "Enter a replacement URL for every remote mapping."
        case .invalidHeaderName: "Enter a valid HTTP header name."
        case .invalidHeaderValue: "Header values cannot contain HTTP control characters."
        case .invalidBlockStatus: "Blocked responses must use a status from 400 through 599."
        case .blockBodyTooLarge: "Blocked response bodies must be 16 KiB or smaller."
        case .invalidDelay: "Delays must be between 0 and 30000 milliseconds."
        }
    }
}
