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

struct ProxyMappingFile: Codable {
    var mapLocal: [ProxyLocalMapping] = []
    var mapRemote: [ProxyRemoteMapping] = []

    func write(to url: URL) throws {
        for rule in mapLocal {
            guard !rule.match.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ProxyMappingError.emptyExpression
            }
            let values = try URL(fileURLWithPath: rule.file).resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true else { throw ProxyMappingError.notAFile }
        }
        for rule in mapRemote {
            guard !rule.match.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ProxyMappingError.emptyExpression
            }
            guard !rule.replace.isEmpty else { throw ProxyMappingError.emptyReplacement }
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(self).write(to: url, options: .atomic)
    }
}

private enum ProxyMappingError: LocalizedError {
    case emptyExpression, notAFile, emptyReplacement
    var errorDescription: String? {
        switch self {
        case .emptyExpression: "Enter a URL expression for every mapping."
        case .notAFile: "Choose a regular file for each local response."
        case .emptyReplacement: "Enter a replacement URL for every remote mapping."
        }
    }
}
