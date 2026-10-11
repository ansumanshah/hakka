import Darwin
import Dispatch
import Foundation
import HakkaProxyEngine

@main
struct ProxyCommand {
    static func main() async {
        do { try await run() }
        catch {
            // Do not publish raw errors that may contain captured traffic or private paths.
            try? FileHandle.standardError.write(contentsOf: Data("Hakka native proxy failed. Check arguments, CA ownership and listener availability.\n".utf8))
            exit(1)
        }
    }

    private static func run() async throws {
        if Array(CommandLine.arguments.dropFirst()) == ["--help"] {
            print("hakka-native-proxy [--host 127.0.0.1] [--port 0] [--max-body-bytes 16384] [--max-connections 128] [--ca-dir /absolute/private/directory] [--upstream-ca /absolute/fixture-ca.pem]")
            return
        }
        let options = try CommandOptions(arguments: Array(CommandLine.arguments.dropFirst()))
        signal(SIGPIPE, SIG_IGN)
        signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
        let (signals, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let sources = [SIGTERM, SIGINT].map { number in
            let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
            source.setEventHandler { continuation.yield(()) }
            source.resume()
            return source
        }
        defer { sources.forEach { $0.cancel() }; continuation.finish() }
        let writer = try JSONLineWriter()
        let recorder = CaptureRecorder { writer.append($0, flow: true) }
        let authority = try options.caDirectory.map { try LocalCertificateAuthority(directory: $0, upstreamCAFile: options.upstreamCA) }
        defer { try? authority?.close() }
        let configuration = try ProxyConfiguration(host: options.host, port: options.port,
            maxConnections: options.maxConnections, maxBodyBytes: options.maxBodyBytes,
            recorder: recorder, tlsProvider: authority)
        let server = try await NativeProxyServer.start(configuration: configuration)
        writer.append(ReadyEvent(host: server.host, port: server.port,
            caCertificatePath: authority?.caCertificateURL.path,
            caFingerprintSHA256: authority?.caFingerprintSHA256,
            coverage: Coverage(httpsInterception: authority != nil)))
        let stopped = await withTaskGroup(of: Void.self, returning: Bool.self) { tasks in
            tasks.addTask { for await _ in signals { break } }
            tasks.addTask { try? await server.wait() }
            await tasks.next()
            continuation.finish()
            tasks.cancelAll()
            // Closing the listener also releases the task waiting on server.wait().
            do { try await server.stop() }
            catch { return false }
            return true
        }
        guard stopped else {
            writer.append(FailureEvent()); _ = writer.flush()
            throw CommandError.shutdownFailed
        }
        try authority?.close()
        let drained = writer.flush()
        writer.append(StoppedEvent(output: writer.statistics, drained: drained))
        if !writer.flush() || writer.statistics.outputFailed { throw CommandError.outputUnavailable }
    }
}

private struct ReadyEvent: Encodable {
    let type = "ready"
    let schemaVersion = 1
    let engine = "swift-nio"
    let host: String
    let port: Int
    let caCertificatePath: String?
    let caFingerprintSHA256: String?
    let coverage: Coverage
}

private struct Coverage: Encodable {
    let httpForwarding = true
    let connectTunnel = true
    let httpsInterception: Bool
    let http2Interception = false
    let webSocketInterception = false
    let connectionReuse = false
    let methods = ["GET", "POST", "CONNECT"]
    let deviceTrust = "unverified"
    let sourceIdentity = "unverified"
}

private struct StoppedEvent: Encodable {
    let type = "stopped"
    let output: OutputStatistics
    let drained: Bool
}

private struct FailureEvent: Encodable {
    let type = "failed"
    let reason = "Proxy shutdown failed; listener release is unconfirmed."
}
