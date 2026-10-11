import Foundation
import Network

/// One ephemeral listener owns every connection and keeps profile bytes only in memory.
@MainActor
final class ProxyDeviceSetupServer {
    static let lifetime: TimeInterval = 8 * 60
    private(set) var link: String?
    private var listener: NWListener?
    private var clients: [UUID: NWConnection] = [:]
    private var deadlines: [UUID: Task<Void, Never>] = [:]
    private var profile = Data()
    private var token = ""
    private var testURL = ""
    private var fingerprint = ""
    private var expires = Date.distantPast
    private var requests = 0
    private var expiryTask: Task<Void, Never>?

    func start(address: String, profile: Data, token: String, fingerprint: String = "", testURL: String, lifetime: TimeInterval = ProxyDeviceSetupServer.lifetime) async throws -> String {
        stop()
        self.profile = profile; self.token = token; self.testURL = testURL; self.fingerprint = fingerprint
        expires = Date().addingTimeInterval(min(Self.lifetime, max(0.05, lifetime)))
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(address), port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        listener.newConnectionHandler = { [weak self] connection in
            Task { @MainActor in self?.accept(connection) }
        }
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            Task { @MainActor in
                guard let self, let listener, self.listener === listener else { return }
                switch state {
                case .ready:
                    if let port = listener.port { self.link = "http://\(address):\(port.rawValue)/\(token)" }
                case .failed, .cancelled: self.stop()
                default: break
                }
            }
        }
        expiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(min(Self.lifetime, max(0.05, lifetime))))
            guard !Task.isCancelled else { return }
            self?.stop()
        }
        listener.start(queue: .main)
        do {
            for _ in 0..<100 {
                guard self.listener === listener else { throw ProxyDeviceSetupError.unavailable }
                if let link { return link }
                try await Task.sleep(for: .milliseconds(20))
            }
        } catch {
            if self.listener === listener { stop() }
            throw error
        }
        if self.listener === listener { stop() }
        throw ProxyDeviceSetupError.unavailable
    }

    func stop() {
        expiryTask?.cancel(); expiryTask = nil
        listener?.cancel(); listener = nil; link = nil
        for client in clients.values { client.cancel() }
        clients.removeAll()
        for deadline in deadlines.values { deadline.cancel() }
        deadlines.removeAll(); profile = Data(); token = ""; testURL = ""; fingerprint = ""; requests = 0
    }

    private func accept(_ connection: NWConnection) {
        guard listener != nil, Date() < expires, clients.count < 4, requests < 64 else { connection.cancel(); return }
        let id = UUID()
        clients[id] = connection
        deadlines[id] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.close(id)
        }
        connection.start(queue: .main)
        receive(connection, id: id, accumulated: Data())
    }

    private func close(_ id: UUID) {
        clients.removeValue(forKey: id)?.cancel()
        deadlines.removeValue(forKey: id)?.cancel()
    }

    private func receive(_ connection: NWConnection, id: UUID, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4097 - accumulated.count) { [weak self] data, _, complete, error in
            Task { @MainActor in
                guard let self, self.clients[id] != nil else { return }
                var bytes = accumulated
                if let data { bytes.append(data) }
                guard bytes.count <= 4096, Date() < self.expires, error == nil else { self.close(id); return }
                if bytes.range(of: Data("\r\n\r\n".utf8)) != nil {
                    self.requests += 1
                    let response = self.response(to: bytes, now: Date())
                    connection.send(content: response, completion: .contentProcessed { [weak self] _ in
                        Task { @MainActor in self?.close(id) }
                    })
                } else if complete { self.close(id) }
                else { self.receive(connection, id: id, accumulated: bytes) }
            }
        }
    }

    /// Strict one-request HTTP parsing. This seam also verifies nonce and expiry without binding a socket.
    func response(to request: Data, now: Date) -> Data {
        var status = "404 Not Found", type = "text/plain; charset=utf-8", body = Data("Unavailable".utf8)
        if now < expires, request.count <= 4096,
           let text = String(data: request, encoding: .utf8),
           let split = text.range(of: "\r\n\r\n"), split.upperBound == text.endIndex {
            let lines = text[..<split.lowerBound].components(separatedBy: "\r\n")
            let first = lines.first?.split(separator: " ") ?? []
            let validHeaders = lines.dropFirst().allSatisfy { line in
                guard let colon = line.firstIndex(of: ":") else { return false }
                let name = line[..<colon].lowercased()
                return name != "content-length" && name != "transfer-encoding" && !name.isEmpty
            }
            if first.count == 3, first[0] == "GET", first[2] == "HTTP/1.1", validHeaders {
                if first[1] == Substring("/\(token)/profile.mobileconfig") {
                    status = "200 OK"; type = "application/x-apple-aspen-config"; body = profile
                } else if first[1] == Substring("/\(token)") {
                    status = "200 OK"; type = "text/html; charset=utf-8"
                    body = Data("""
                    <!doctype html><meta name="viewport" content="width=device-width"><title>Hakka device setup</title>
                    <h1>Hakka temporary device setup</h1>
                    <p>Public CA SHA-256 fingerprint: <code>\(fingerprint)</code>. Confirm this imported certificate before enabling Full Trust.</p>
                    <p>Use Safari on your iPhone connected to the selected Wi-Fi. Download the profile, then install in Settings → General → VPN &amp; Device Management. Enter Wi-Fi credentials on the phone if prompted.</p>
                    <p>Enable Full Trust for the imported CA (its certificate name may differ from the profile payload name) in Settings → General → About → Certificate Trust Settings. This permits Hakka to inspect HTTPS on this Wi-Fi.</p>
                    <p><a href="/\(token)/profile.mobileconfig">Download removable profile</a></p>
                    <p>After installation and full trust: <a href="\(testURL)">Send HTTPS test request</a>.</p>
                    <p>When finished, remove Hakka Temporary Device Setup in Settings → General → VPN &amp; Device Management, and restore previously recorded Wi-Fi proxy settings (Off only if it was originally Off).</p>
                    """.utf8)
                }
            }
        }
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\n\r\n"
        return Data(headers.utf8) + body
    }
}
