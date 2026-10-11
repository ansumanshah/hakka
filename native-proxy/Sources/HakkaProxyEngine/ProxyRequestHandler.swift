import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL

final class ProxyRequestHandler: ChannelInboundHandler, RemovableChannelHandler, @unchecked Sendable {
    typealias InboundIn = HTTPServerRequestPart
    typealias OutboundOut = HTTPServerResponsePart
    let configuration: ProxyConfiguration
    let connections: ProxyConnections
    let fixedAuthority: ProxyAuthority?
    var upstream: (any Channel)?
    var capture: ProxyCapture?
    private var pending: [HTTPClientRequestPart] = []
    private var pendingBytes = 0
    private var started = false
    private var isConnect = false
    private var connectHead: HTTPRequestHead?
    private var connectAuthority: ProxyAuthority?
    private var failed = false

    init(configuration: ProxyConfiguration, connections: ProxyConnections, fixedAuthority: ProxyAuthority? = nil) {
        self.configuration = configuration; self.connections = connections; self.fixedAuthority = fixedAuthority
    }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        guard !failed else { return }
        switch unwrapInboundIn(data) {
        case .head(var head):
            guard !started else { fail(context, status: .badRequest, reason: "HTTP pipelining unsupported"); return }
            started = true
            do {
                guard head.headers["host"].count <= 1, head.headers["upgrade"].isEmpty else { throw ProxyTransportError.unsupportedProtocol }
                if head.method == .CONNECT {
                    guard fixedAuthority == nil, !head.headers.contains(name: "content-length"), !head.headers.contains(name: "transfer-encoding") else { throw ProxyTransportError.invalidRequest }
                    connectAuthority = try ProxyAuthority.parse(head.uri)
                    isConnect = true; connectHead = head; return
                }
                guard head.method == .GET || head.method == .POST else { throw ProxyTransportError.unsupportedProtocol }
                let authority: ProxyAuthority
                let url: String
                if let fixedAuthority {
                    authority = fixedAuthority
                    if head.uri.hasPrefix("/") {
                        guard !head.uri.hasPrefix("//") else { throw ProxyTransportError.invalidRequest }
                        url = "https://\(authority.header)\(head.uri)"
                    } else {
                        guard let components = URLComponents(string: head.uri), components.scheme == "https",
                              components.user == nil, components.password == nil, components.fragment == nil,
                              let host = components.host,
                              ProxyAuthority(host: host.lowercased(), port: components.port ?? 443) == authority else { throw ProxyTransportError.invalidRequest }
                        url = head.uri; head.uri = origin(components)
                    }
                    if let host = head.headers["host"].first {
                        guard try ProxyAuthority.parse(host, defaultPort: 443) == authority else { throw ProxyTransportError.invalidRequest }
                    }
                } else {
                    guard let components = URLComponents(string: head.uri), components.scheme == "http",
                          components.user == nil, components.password == nil, components.fragment == nil,
                          let host = components.host else { throw ProxyTransportError.invalidRequest }
                    authority = try ProxyAuthority.parse(host.contains(":") ? "[\(host)]:\(components.port ?? 80)" : "\(host):\(components.port ?? 80)")
                    url = head.uri; head.uri = origin(components)
                    if let host = head.headers["host"].first {
                        guard try ProxyAuthority.parse(host, defaultPort: 80) == authority else { throw ProxyTransportError.invalidRequest }
                    }
                }
                capture = ProxyCapture(head: head, url: url, configuration: configuration)
                let expectsContinue = head.headers["expect"].contains { $0.lowercased() == "100-continue" }
                if !head.headers["expect"].isEmpty && !expectsContinue { throw ProxyTransportError.unsupportedProtocol }
                let wasChunked = !head.headers["transfer-encoding"].isEmpty
                head.headers = proxyHeaders(head.headers, close: true)
                if wasChunked { head.headers.replaceOrAdd(name: "Transfer-Encoding", value: "chunked") }
                head.headers.remove(name: "Expect")
                head.headers.replaceOrAdd(name: "Host", value: authority.header)
                enqueue(.head(head), context: context)
                connectHTTP(authority, client: context.channel)
                if expectsContinue {
                    context.channel.write(HTTPServerResponsePart.head(.init(version: .http1_1, status: .continue)), promise: nil)
                    context.channel.writeAndFlush(HTTPServerResponsePart.end(nil), promise: nil)
                }
            } catch { fail(context, status: .badRequest, reason: "Invalid or unsupported proxy request") }
        case .body(let buffer):
            guard !isConnect else { fail(context, status: .badRequest, reason: "CONNECT body unsupported"); return }
            capture?.append(buffer, isRequest: true)
            enqueue(.body(.byteBuffer(buffer)), context: context)
        case .end:
            if isConnect, let head = connectHead, let authority = connectAuthority {
                capture = ProxyCapture(head: head, url: "https://\(authority.header)", configuration: configuration)
                ProxyConnectUpgrade.begin(context: context, handler: self, authority: authority)
            } else { enqueue(.end(nil), context: context) }
        }
    }
    private func origin(_ url: URLComponents) -> String {
        (url.percentEncodedPath.isEmpty ? "/" : url.percentEncodedPath) + (url.percentEncodedQuery.map { "?\($0)" } ?? "")
    }
    private func enqueue(_ part: HTTPClientRequestPart, context: ChannelHandlerContext) {
        if let upstream { upstream.writeAndFlush(part, promise: nil); pauseIfNeeded(client: context.channel, upstream: upstream) }
        else {
            if case .body(.byteBuffer(let buffer)) = part { pendingBytes += buffer.readableBytes }
            guard pendingBytes <= 65536, pending.count < 128 else { fail(context, status: .payloadTooLarge, reason: "Pending request buffer limit"); return }
            pending.append(part)
        }
    }
    func connectHTTP(_ authority: ProxyAuthority, client: any Channel) {
        client.setOption(ChannelOptions.autoRead, value: false).whenFailure { _ in }
        let bootstrap = ClientBootstrap(group: client.eventLoop)
            .connectTimeout(.seconds(configuration.connectTimeoutSeconds))
            .channelOption(ChannelOptions.allowRemoteHalfClosure, value: true)
            .channelInitializer { channel in
                do {
                    if self.fixedAuthority != nil {
                        guard let provider = self.configuration.tlsProvider else { throw ProxyTransportError.unsupportedProtocol }
                        let isIPAddress = (try? SocketAddress(ipAddress: authority.host, port: authority.port)) != nil
                        // Full verification with nil SNI matches the certificate IP SAN to the connected peer address.
                        let serverHostname: String? = isIPAddress ? nil : authority.host
                        try channel.pipeline.syncOperations.addHandler(NIOSSLClientHandler(context: provider.clientContext(), serverHostname: serverHostname))
                    }
                    try channel.pipeline.syncOperations.addHandlers([
                        IdleStateHandler(readTimeout: .seconds(self.configuration.idleTimeoutSeconds)),
                        HTTPRequestEncoder(), proxyResponseDecoder(),
                        ProxyResponseHandler(client: client, owner: self)
                    ])
                    return channel.eventLoop.makeSucceededVoidFuture()
                } catch { return channel.eventLoop.makeFailedFuture(error) }
            }
        bootstrap.connect(host: authority.host, port: authority.port).whenComplete { result in
            switch result {
            case .success(let channel):
                guard client.isActive, !self.failed, self.connections.trackUpstream(channel) else { channel.close(promise: nil); return }
                channel.closeFuture.whenComplete { _ in self.connections.remove(channel) }
                self.upstream = channel
                for part in self.pending { channel.write(part, promise: nil) }
                self.pending.removeAll(); channel.flush()
                if channel.isWritable { client.setOption(ChannelOptions.autoRead, value: true).whenFailure { _ in } }
            case .failure:
                self.fail(client, status: .badGateway, reason: "Upstream connection failed")
            }
        }
    }
    func pauseIfNeeded(client: any Channel, upstream: any Channel) {
        if !upstream.isWritable { client.setOption(ChannelOptions.autoRead, value: false).whenFailure { _ in } }
    }
    func fail(_ context: ChannelHandlerContext, status: HTTPResponseStatus, reason: String) { fail(context.channel, status: status, reason: reason) }
    func fail(_ client: any Channel, status: HTTPResponseStatus, reason: String) {
        guard !failed else { return }; failed = true
        capture?.finish(error: reason); upstream?.close(promise: nil)
        var headers = HTTPHeaders(); headers.add(name: "Content-Length", value: "0"); headers.add(name: "Connection", value: "close")
        client.write(HTTPServerResponsePart.head(.init(version: .http1_1, status: status, headers: headers)), promise: nil)
        client.writeAndFlush(HTTPServerResponsePart.end(nil)).whenComplete { _ in client.close(promise: nil) }
    }
    func channelWritabilityChanged(context: ChannelHandlerContext) {
        upstream?.setOption(ChannelOptions.autoRead, value: context.channel.isWritable).whenFailure { _ in }
        context.fireChannelWritabilityChanged()
    }
    func channelInactive(context: ChannelHandlerContext) { upstream?.close(promise: nil); capture?.finish(error: "Client disconnected"); context.fireChannelInactive() }
    func errorCaught(context: ChannelHandlerContext, error: Error) { fail(context, status: .badRequest, reason: "Proxy transport error") }
    func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
        if event is IdleStateHandler.IdleStateEvent { capture?.finish(error: "Connection idle timeout"); upstream?.close(promise: nil); context.close(promise: nil) }
        else { context.fireUserInboundEventTriggered(event) }
    }
}
