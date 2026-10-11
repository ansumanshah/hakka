import Foundation
import Darwin
import NIOCore
import NIOSSL

public enum LocalCertificateAuthorityError: Error, Sendable {
    case unsafeDirectory, directoryInUse, invalidHost, invalidAuthority
    case certificateOperationFailed, processTimedOut, processTerminationUnconfirmed, overloaded, closed
}

/// Task-local CA and bounded HTTP/1 TLS contexts. Initialization and close must run off event loops.
/// Native OpenSSL is required; certificates are never installed in the OS trust store.
public final class LocalCertificateAuthority: ProxyTLSProvider, @unchecked Sendable {
    public let caCertificateURL: URL
    public let caFingerprintSHA256: String
    private let directory: CertificateDirectory
    private let caKeyURL: URL
    private let process: CertificateProcess
    private let upstreamContext: NIOSSLContext
    private let queue = DispatchQueue(label: "dev.hakka.proxy.certificates", qos: .utility)
    private let lock = NSLock()
    private let closeLock = NSLock()
    private var isDrained = false
    // The lock owns admission/coalescing; the serial queue owns the leaf context LRU.
    private var pending: [String: [EventLoopPromise<NIOSSLContext>]] = [:]
    private var isClosed = false
    private var contexts: [String: (context: NIOSSLContext, expires: Date)] = [:]
    private var recentHosts: [String] = []
    private static let capacity = 128

    public init(directory: URL, upstreamCAFile: URL? = nil,
                opensslPath: String = "/usr/bin/openssl") throws {
        let ownedDirectory = try CertificateDirectory(directory)
        let runner = CertificateProcess(executable: opensslPath)
        defer {
            if !runner.canCleanup {
                runner.whenTerminated { [ownedDirectory] in ownedDirectory.close() }
            }
        }
        let certificate = ownedDirectory.url.appendingPathComponent("ca-cert.pem")
        let key = ownedDirectory.url.appendingPathComponent("ca-key.pem")
        let hasCertificate = try ownedDirectory.exists(certificate)
        let hasKey = try ownedDirectory.exists(key, privateKey: true)
        guard hasCertificate == hasKey else { throw LocalCertificateAuthorityError.invalidAuthority }
        if !hasCertificate {
            try Self.generateAuthority(directory: ownedDirectory, runner: runner,
                                       certificate: certificate, key: key)
        }
        try Self.validateAuthority(runner: runner, certificate: certificate, key: key)
        var clientConfiguration = TLSConfiguration.makeClientConfiguration()
        clientConfiguration.certificateVerification = .fullVerification
        clientConfiguration.applicationProtocols = ["http/1.1"]
        if let upstreamCAFile {
            clientConfiguration.trustRoots = .file(upstreamCAFile.path)
        }
        upstreamContext = try NIOSSLContext(configuration: clientConfiguration)
        self.directory = ownedDirectory
        self.process = runner
        caCertificateURL = certificate
        caKeyURL = key
        let fingerprint = try runner.run(["x509", "-in", certificate.path,
                                          "-noout", "-fingerprint", "-sha256"])
        guard let value = fingerprint.split(separator: "=").last else {
            throw LocalCertificateAuthorityError.invalidAuthority
        }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ":", with: "").lowercased()
        guard normalized.count == 64, normalized.allSatisfy({ $0.isHexDigit }) else {
            throw LocalCertificateAuthorityError.invalidAuthority
        }
        caFingerprintSHA256 = normalized
    }

    public func clientContext() throws -> NIOSSLContext { upstreamContext }

    public func serverContext(for host: String, on eventLoop: any EventLoop) -> EventLoopFuture<NIOSSLContext> {
        let name: String
        do { name = try Self.validateHost(host) }
        catch { return eventLoop.makeFailedFuture(error) }
        let promise = eventLoop.makePromise(of: NIOSSLContext.self)
        lock.lock()
        if isClosed {
            lock.unlock()
            promise.fail(LocalCertificateAuthorityError.closed)
        } else if let waiters = pending[name] {
            // Bound duplicate waiters as well as distinct generation requests.
            guard waiters.count < Self.capacity else {
                lock.unlock()
                promise.fail(LocalCertificateAuthorityError.overloaded)
                return promise.futureResult
            }
            pending[name, default: []].append(promise)
            lock.unlock()
        } else if pending.count >= Self.capacity {
            lock.unlock()
            promise.fail(LocalCertificateAuthorityError.overloaded)
        } else {
            pending[name] = [promise]
            // Submit while holding the admission lock so close cannot overtake accepted work.
            queue.async { [self] in
                let result = Result { try context(for: name) }
                lock.lock()
                let waiters = pending.removeValue(forKey: name) ?? []
                let finalResult = isClosed ? Result<NIOSSLContext, Error>.failure(LocalCertificateAuthorityError.closed) : result
                for waiter in waiters { waiter.completeWith(finalResult) }
                lock.unlock()
            }
            lock.unlock()
        }
        return promise.futureResult
    }

    /// Cancels signing, drains queued work, and releases ownership only after confirmed child exit.
    /// Call outside NIO event loops; unconfirmed termination throws and preserves temporary files.
    public func close() throws {
        closeLock.lock(); defer { closeLock.unlock() }
        guard !isDrained else { return }
        lock.lock()
        isClosed = true
        let waiters = pending.values.flatMap { $0 }
        pending.removeAll()
        lock.unlock()
        for waiter in waiters { waiter.fail(LocalCertificateAuthorityError.closed) }
        // Even if immediate cancellation cannot confirm exit, drain the worker before reporting.
        do { try process.cancel() }
        catch LocalCertificateAuthorityError.processTerminationUnconfirmed {}
        queue.sync {
            contexts.removeAll()
            recentHosts.removeAll()
            if process.canCleanup { directory.close() }
            else { process.whenTerminated { [directory] in directory.close() } }
        }
        guard process.canCleanup else { throw LocalCertificateAuthorityError.processTerminationUnconfirmed }
        isDrained = true
    }

    private func context(for host: String) throws -> NIOSSLContext {
        lock.lock()
        let closed = isClosed
        lock.unlock()
        guard !closed else { throw LocalCertificateAuthorityError.closed }
        if let cached = contexts[host], cached.expires > Date() {
            recentHosts.removeAll { $0 == host }
            recentHosts.append(host)
            return cached.context
        }
        _ = try process.run(["x509", "-in", caCertificateURL.path, "-noout", "-checkend", "691200"])
        let temporary = try directory.temporaryDirectory()
        defer { if process.canCleanup { try? FileManager.default.removeItem(at: temporary) } }
        let config = temporary.appendingPathComponent("request.cnf")
        let key = temporary.appendingPathComponent("leaf-key.pem")
        let request = temporary.appendingPathComponent("leaf.csr")
        let certificate = temporary.appendingPathComponent("leaf-cert.pem")
        let sanType = Self.isIPAddress(host) ? "IP" : "DNS"
        try Self.writeConfiguration("""
        [req]
        distinguished_name = subject
        [subject]
        [leaf]
        basicConstraints = critical,CA:FALSE
        keyUsage = critical,digitalSignature,keyEncipherment
        extendedKeyUsage = serverAuth
        subjectAltName = \(sanType):\(host)
        """, to: config)
        _ = try process.run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
                             "-keyout", key.path, "-out", request.path,
                             "-subj", "/CN=Hakka Local Leaf", "-config", config.path])
        guard chmod(key.path, 0o600) == 0 else { throw LocalCertificateAuthorityError.unsafeDirectory }
        let serial = "0x" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        _ = try process.run(["x509", "-req", "-in", request.path, "-CA", caCertificateURL.path,
                             "-CAkey", caKeyURL.path, "-set_serial", serial, "-days", "7", "-sha256",
                             "-extfile", config.path, "-extensions", "leaf", "-out", certificate.path])
        _ = try process.run(["verify", "-CAfile", caCertificateURL.path, "-purpose", "sslserver", certificate.path])
        _ = try process.run(["x509", "-in", certificate.path, "-noout", "-checkend", "3600"])
        let chain = try NIOSSLCertificate.fromPEMFile(certificate.path).map { NIOSSLCertificateSource.certificate($0) }
        var configuration = TLSConfiguration.makeServerConfiguration(certificateChain: chain, privateKey: .privateKey(try NIOSSLPrivateKey(file: key.path, format: .pem)))
        configuration.applicationProtocols = ["http/1.1"]
        let context = try NIOSSLContext(configuration: configuration)
        if contexts.count == Self.capacity, let oldest = recentHosts.first {
            contexts.removeValue(forKey: oldest)
            recentHosts.removeFirst()
        }
        contexts[host] = (context, Date().addingTimeInterval(6 * 86_400))
        recentHosts.removeAll { $0 == host }
        recentHosts.append(host)
        return context
    }

    private static func generateAuthority(directory: CertificateDirectory, runner: CertificateProcess,
                                          certificate: URL, key: URL) throws {
        let temporary = try directory.temporaryDirectory()
        defer { if runner.canCleanup { try? FileManager.default.removeItem(at: temporary) } }
        let config = temporary.appendingPathComponent("authority.cnf")
        let temporaryCertificate = temporary.appendingPathComponent("ca.pem")
        let temporaryKey = temporary.appendingPathComponent("ca-key.pem")
        try writeConfiguration("""
        [req]
        distinguished_name = subject
        x509_extensions = authority
        [subject]
        [authority]
        basicConstraints = critical,CA:TRUE,pathlen:0
        keyUsage = critical,keyCertSign,cRLSign
        subjectKeyIdentifier = hash
        """, to: config)
        _ = try runner.run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "30",
                            "-keyout", temporaryKey.path, "-out", temporaryCertificate.path,
                            "-subj", "/CN=Hakka Task Local CA", "-config", config.path])
        guard chmod(temporaryKey.path, 0o600) == 0 else { throw LocalCertificateAuthorityError.unsafeDirectory }
        try validateAuthority(runner: runner, certificate: temporaryCertificate, key: temporaryKey)
        try FileManager.default.moveItem(at: temporaryKey, to: key)
        try FileManager.default.moveItem(at: temporaryCertificate, to: certificate)
    }

    private static func validateAuthority(runner: CertificateProcess, certificate: URL, key: URL) throws {
        let text = try runner.run(["x509", "-in", certificate.path, "-noout", "-text"])
        guard hasExtension("X509v3 Basic Constraints: critical", containing: ["CA:TRUE"], in: text),
              hasExtension("X509v3 Key Usage: critical", containing: ["Certificate Sign", "CRL Sign"], in: text) else {
            throw LocalCertificateAuthorityError.invalidAuthority
        }
        _ = try runner.run(["x509", "-in", certificate.path, "-noout", "-checkend", "691200"])
        _ = try runner.run(["verify", "-check_ss_sig", "-CAfile", certificate.path, certificate.path])
        let certificatePublicKey = try runner.run(["x509", "-in", certificate.path, "-pubkey", "-noout"])
        let keyPublicKey = try runner.run(["pkey", "-in", key.path, "-pubout"])
        guard certificatePublicKey == keyPublicKey else { throw LocalCertificateAuthorityError.invalidAuthority }
    }

    private static func hasExtension(_ heading: String, containing values: [String], in text: String) -> Bool {
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let index = lines.firstIndex(of: heading), index + 1 < lines.count else { return false }
        return values.allSatisfy { lines[index + 1].contains($0) }
    }

    private static func writeConfiguration(_ content: String, to url: URL) throws {
        try Data(content.utf8).write(to: url, options: .withoutOverwriting)
        guard chmod(url.path, 0o600) == 0 else { throw LocalCertificateAuthorityError.unsafeDirectory }
    }

    private static func validateHost(_ host: String) throws -> String {
        guard !host.isEmpty, host.utf8.count <= 253, host.utf8.allSatisfy({ $0 < 128 }) else {
            throw LocalCertificateAuthorityError.invalidHost
        }
        let normalized = host.lowercased()
        if isIPAddress(normalized) { return normalized }
        let name = normalized.hasSuffix(".") ? String(normalized.dropLast()) : normalized
        let labels = name.split(separator: ".", omittingEmptySubsequences: false)
        guard !labels.isEmpty, labels.allSatisfy({ label in
            !label.isEmpty && label.count <= 63 && label.first != "-" && label.last != "-" &&
            label.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }
        }) else { throw LocalCertificateAuthorityError.invalidHost }
        // Reject malformed numeric address literals instead of interpreting them as DNS names.
        guard !name.utf8.allSatisfy({ (48...57).contains($0) || $0 == 46 }) else {
            throw LocalCertificateAuthorityError.invalidHost
        }
        return name
    }

    private static func isIPAddress(_ host: String) -> Bool {
        var address = in6_addr()
        return host.withCString { inet_pton(AF_INET, $0, &address) == 1 || inet_pton(AF_INET6, $0, &address) == 1 }
    }
}
