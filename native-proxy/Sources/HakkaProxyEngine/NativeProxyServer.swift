import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1

public final class NativeProxyServer: @unchecked Sendable {
    public let host: String
    public let port: Int
    private let listener: any Channel
    private let group: MultiThreadedEventLoopGroup
    private let connections: ProxyConnections
    private let lock = NSLock()
    private var stopTask: Task<Void, Error>?

    private init(listener: any Channel, group: MultiThreadedEventLoopGroup, connections: ProxyConnections) {
        self.listener = listener; self.group = group; self.connections = connections
        host = listener.localAddress?.ipAddress ?? "127.0.0.1"
        port = listener.localAddress?.port ?? 0
    }

    public static func start(configuration: ProxyConfiguration) async throws -> NativeProxyServer {
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 2)
        let connections = ProxyConnections(limit: configuration.maxConnections)
        do {
            let channel = try await ServerBootstrap(group: group)
                .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
                .childChannelOption(ChannelOptions.allowRemoteHalfClosure, value: true)
                .childChannelOption(ChannelOptions.recvAllocator, value: AdaptiveRecvByteBufferAllocator(minimum: 1024, initial: 8192, maximum: 16384))
                .childChannelInitializer { channel in
                    guard connections.reserve(channel) else { return channel.close() }
                    channel.closeFuture.whenComplete { _ in connections.remove(channel) }
                    do {
                        try channel.pipeline.syncOperations.addHandler(IdleStateHandler(readTimeout: .seconds(configuration.idleTimeoutSeconds)))
                        try channel.pipeline.syncOperations.addHandler(HTTPResponseEncoder(), name: "proxy-response-encoder")
                        try channel.pipeline.syncOperations.addHandler(proxyDecoder(), name: "proxy-request-decoder")
                        try channel.pipeline.syncOperations.addHandler(ProxyRequestHandler(configuration: configuration, connections: connections))
                        return channel.eventLoop.makeSucceededVoidFuture()
                    } catch { return channel.eventLoop.makeFailedFuture(error) }
                }.bind(host: configuration.host, port: configuration.port).get()
            return .init(listener: channel, group: group, connections: connections)
        } catch {
            try? await shutdownProxyGroup(group)
            throw error
        }
    }
    public func wait() async throws { try await listener.closeFuture.get() }
    public func stop() async throws { try await stoppingTask().value }
    private func stoppingTask() -> Task<Void, Error> {
        lock.lock(); defer { lock.unlock() }
        if let stopTask { return stopTask }
        let task = Task {
            var failure: (any Error)?
            do { try await self.listener.close().get() } catch { failure = error }
            do { try await self.connections.closeAll() } catch { if failure == nil { failure = error } }
            do { try await shutdownProxyGroup(self.group) } catch { if failure == nil { failure = error } }
            if let failure { throw failure }
        }
        stopTask = task
        return task
    }
}

private func shutdownProxyGroup(_ group: MultiThreadedEventLoopGroup) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        group.shutdownGracefully { error in
            if let error { continuation.resume(throwing: error) } else { continuation.resume() }
        }
    }
}

final class ProxyConnections: @unchecked Sendable {
    private let lock = NSLock()
    private var channels: [ObjectIdentifier: any Channel] = [:]
    private var stopped = false
    private var accepted: Set<ObjectIdentifier> = []
    private let limit: Int
    init(limit: Int) { self.limit = limit }
    func reserve(_ channel: any Channel) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !stopped, accepted.count < limit else { return false }
        channels[ObjectIdentifier(channel)] = channel; accepted.insert(ObjectIdentifier(channel)); return true
    }
    func trackUpstream(_ channel: any Channel) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !stopped else { return false }
        channels[ObjectIdentifier(channel)] = channel; return true
    }
    func remove(_ channel: any Channel) {
        lock.lock(); defer { lock.unlock() }; channels.removeValue(forKey: ObjectIdentifier(channel)); accepted.remove(ObjectIdentifier(channel))
    }
    private func drain() -> [any Channel] {
        lock.lock(); defer { lock.unlock() }; stopped = true
        return Array(channels.values)
    }
    func closeAll() async throws {
        var failure: (any Error)?
        for channel in drain() where channel.isActive {
            do { try await channel.close().get() } catch { if failure == nil { failure = error } }
        }
        if let failure { throw failure }
    }
}
