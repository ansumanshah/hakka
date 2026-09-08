import Foundation

enum ProxyProcessEvent: Sendable {
    case status(ProxyStatusLine)
    case failure(String)
    case exited(Int32)
}

/// Streams the CLI's JSON status without blocking Swift's cooperative executor.
enum ProxyProcessStream {
    static func launch(executable: URL, arguments: [String]) throws -> (Process, AsyncStream<ProxyProcessEvent>) {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        process.standardOutput = output
        // JSON mode carries actionable diagnostics on stdout. Drain stderr
        // to the null device rather than allowing an unread pipe to stall.
        process.standardError = FileHandle.nullDevice
        let (events, continuation) = AsyncStream<ProxyProcessEvent>.makeStream(bufferingPolicy: .bufferingNewest(100))
        try process.run()
        try? output.fileHandleForWriting.close()
        DispatchQueue.global(qos: .utility).async {
            var pending = Data()
            defer {
                try? output.fileHandleForReading.close()
                process.waitUntilExit()
                continuation.yield(.exited(process.terminationStatus))
                continuation.finish()
            }
            do {
                while let chunk = try output.fileHandleForReading.read(upToCount: 4096), !chunk.isEmpty {
                    pending.append(chunk)
                    while let end = pending.firstIndex(of: 10) {
                        let line = pending.prefix(upTo: end)
                        pending.removeSubrange(...end)
                        guard !line.isEmpty else { continue }
                        guard line.count <= 65536 else {
                            continuation.yield(.failure("The proxy status exceeded its size limit."))
                            process.terminate()
                            return
                        }
                        guard let status = try? JSONDecoder().decode(ProxyStatusLine.self, from: line) else {
                            continuation.yield(.failure("The proxy returned an invalid status message."))
                            process.terminate()
                            return
                        }
                        continuation.yield(.status(status))
                    }
                    if pending.count > 65536 {
                        continuation.yield(.failure("The proxy status exceeded its size limit."))
                        process.terminate()
                        return
                    }
                }
                if !pending.isEmpty {
                    if let status = try? JSONDecoder().decode(ProxyStatusLine.self, from: pending) {
                        continuation.yield(.status(status))
                    } else { continuation.yield(.failure("The proxy returned an incomplete status message.")) }
                }
            } catch {
                continuation.yield(.failure("Could not read proxy status."))
                if process.isRunning { process.terminate() }
            }
        }
        return (process, events)
    }
}
