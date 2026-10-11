import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL

struct ProxyConnectUpgrade {
    static func begin(context: ChannelHandlerContext, handler: ProxyRequestHandler, authority: ProxyAuthority) {
        let client = context.channel
        client.setOption(ChannelOptions.autoRead, value: false).whenFailure { _ in }
        let configuration = handler.configuration
        let contextFuture: EventLoopFuture<NIOSSLContext?>
        if let provider = configuration.tlsProvider {
            contextFuture = provider.serverContext(for: authority.host, on: client.eventLoop).map { Optional($0) }
        } else { contextFuture = client.eventLoop.makeSucceededFuture(nil) }
        contextFuture.flatMap { tlsContext in
            ClientBootstrap(group: client.eventLoop)
                .connectTimeout(.seconds(configuration.connectTimeoutSeconds))
                .channelOption(ChannelOptions.autoRead, value: false)
                .channelOption(ChannelOptions.allowRemoteHalfClosure, value: true)
                .connect(host: authority.host, port: authority.port)
                .map { (tlsContext, $0) }
        }.whenComplete { result in
            switch result {
            case .failure:
                handler.fail(client, status: .badGateway, reason: "CONNECT upstream or certificate unavailable")
            case .success(let (tlsContext, upstream)):
                guard client.isActive, handler.connections.trackUpstream(upstream) else { upstream.close(promise: nil); return }
                upstream.closeFuture.whenComplete { _ in handler.connections.remove(upstream) }
                handler.upstream = upstream
                client.pipeline.removeHandler(name: "proxy-response-encoder").flatMap {
                    var response = client.allocator.buffer(capacity: 64)
                    response.writeString("HTTP/1.1 200 Connection Established\r\n\r\n")
                    return client.writeAndFlush(response)
                }.flatMap {
                    client.pipeline.removeHandler(handler)
                }.flatMap {
                    do {
                        if let tlsContext {
                            // Insert TLS after the old decoder so its buffered bytes pass through TLS when removed.
                            try client.pipeline.syncOperations.addHandler(NIOSSLServerHandler(context: tlsContext))
                            try client.pipeline.syncOperations.addHandler(HTTPResponseEncoder(), name: "proxy-response-encoder")
                            try client.pipeline.syncOperations.addHandler(proxyDecoder(), name: "proxy-decrypted-decoder")
                            try client.pipeline.syncOperations.addHandler(ProxyRequestHandler(configuration: configuration, connections: handler.connections, fixedAuthority: authority))
                            handler.capture?.flow.status = 200
                            handler.capture?.finish()
                            // The readiness socket owns no request. Decrypted requests open verified TLS upstream.
                            upstream.close(promise: nil)
                        } else {
                            try client.pipeline.syncOperations.addHandler(ProxyTunnelRelay(peer: upstream, capture: handler.capture))
                            try upstream.pipeline.syncOperations.addHandlers([
                                IdleStateHandler(readTimeout: .seconds(configuration.idleTimeoutSeconds)),
                                ProxyTunnelRelay(peer: client)
                            ])
                            handler.capture?.flow.status = 200
                        }
                        return client.pipeline.removeHandler(name: "proxy-request-decoder")
                    } catch { return client.eventLoop.makeFailedFuture(error) }
                }.whenComplete { completion in
                    switch completion {
                    case .success:
                        client.setOption(ChannelOptions.autoRead, value: true).whenFailure { _ in }
                        if tlsContext == nil { upstream.setOption(ChannelOptions.autoRead, value: true).whenFailure { _ in } }
                    case .failure:
                        handler.capture?.finish(error: "CONNECT pipeline upgrade failed")
                        upstream.close(promise: nil); client.close(promise: nil)
                    }
                }
            }
        }
    }
}
