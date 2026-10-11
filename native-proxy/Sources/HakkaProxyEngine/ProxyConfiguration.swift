import Foundation
import NIOCore
import NIOSSL

public protocol ProxyTLSProvider: Sendable {
    func serverContext(for host: String, on eventLoop: any EventLoop) -> EventLoopFuture<NIOSSLContext>
    func clientContext() throws -> NIOSSLContext
}

/// Fixed operator configuration; it does not change OS routing or certificate trust.
public struct ProxyConfiguration: Sendable {
    public let host: String
    public let port: Int
    public let maxConnections: Int
    public let maxBodyBytes: Int
    public let connectTimeoutSeconds: Int64
    public let idleTimeoutSeconds: Int64
    public let recorder: CaptureRecorder
    public let tlsProvider: (any ProxyTLSProvider)?

    public init(host: String = "127.0.0.1", port: Int = 0, maxConnections: Int = 128,
                maxBodyBytes: Int = 16_384, connectTimeoutSeconds: Int64 = 5,
                idleTimeoutSeconds: Int64 = 30, recorder: CaptureRecorder,
                tlsProvider: (any ProxyTLSProvider)? = nil) throws {
        guard ["127.0.0.1", "::1"].contains(host), (0...65535).contains(port),
              (1...1024).contains(maxConnections), (0...1_048_576).contains(maxBodyBytes),
              (1...60).contains(connectTimeoutSeconds), (1...300).contains(idleTimeoutSeconds) else {
            throw ProxyConfigurationError.invalidLimits
        }
        self.host = host
        self.port = port
        self.maxConnections = maxConnections
        self.maxBodyBytes = maxBodyBytes
        self.connectTimeoutSeconds = connectTimeoutSeconds
        self.idleTimeoutSeconds = idleTimeoutSeconds
        self.recorder = recorder
        self.tlsProvider = tlsProvider
    }
}

public enum ProxyConfigurationError: Error { case invalidLimits }
