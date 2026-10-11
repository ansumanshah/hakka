import Foundation

struct CommandOptions {
    var host = "127.0.0.1"
    var port = 0
    var maxBodyBytes = 16_384
    var maxConnections = 128
    var caDirectory: URL?
    var upstreamCA: URL?

    init(arguments: [String]) throws {
        guard arguments.count % 2 == 0 else { throw CommandError.invalidArguments }
        var seen = Set<String>()
        for index in stride(from: 0, to: arguments.count, by: 2) {
            let flag = arguments[index], value = arguments[index + 1]
            guard seen.insert(flag).inserted else { throw CommandError.invalidArguments }
            switch flag {
            case "--host": host = value
            case "--port": guard let parsed = Int(value) else { throw CommandError.invalidArguments }; port = parsed
            case "--max-body-bytes": guard let parsed = Int(value) else { throw CommandError.invalidArguments }; maxBodyBytes = parsed
            case "--max-connections": guard let parsed = Int(value) else { throw CommandError.invalidArguments }; maxConnections = parsed
            case "--ca-dir": caDirectory = try Self.absoluteURL(value)
            case "--upstream-ca": upstreamCA = try Self.absoluteURL(value)
            default: throw CommandError.invalidArguments
            }
        }
        if upstreamCA != nil && caDirectory == nil { throw CommandError.invalidArguments }
    }

    private static func absoluteURL(_ value: String) throws -> URL {
        guard value.hasPrefix("/"), !value.contains("\0") else { throw CommandError.invalidArguments }
        return URL(fileURLWithPath: value)
    }
}

enum CommandError: Error { case invalidArguments, outputUnavailable, shutdownFailed }
