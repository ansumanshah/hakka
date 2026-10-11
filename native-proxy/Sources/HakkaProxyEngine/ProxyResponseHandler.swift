import NIOCore
import NIOHTTP1
import NIOSSL

final class ProxyResponseHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = HTTPClientResponsePart
    let client: any Channel
    let owner: ProxyRequestHandler
    private var completed = false
    private var responseStarted = false
    private var isInformational = false
    private var informationalCount = 0
    init(client: any Channel, owner: ProxyRequestHandler) { self.client = client; self.owner = owner }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        switch unwrapInboundIn(data) {
        case .head(var head):
            guard head.status != .switchingProtocols else { owner.fail(client, status: .badGateway, reason: "Protocol upgrade unsupported"); return }
            isInformational = (100..<200).contains(head.status.code)
            if isInformational {
                informationalCount += 1
                guard informationalCount <= 32 else {
                    owner.fail(client, status: .badGateway, reason: "Informational response limit")
                    context.close(promise: nil)
                    return
                }
                head.headers = proxyHeaders(head.headers)
                client.write(HTTPServerResponsePart.head(head), promise: nil)
                // NIO's response decoder emits only a head for informational responses.
                client.writeAndFlush(HTTPServerResponsePart.end(nil), promise: nil)
                return
            }
            responseStarted = true
            owner.capture?.flow.status = Int(head.status.code)
            owner.capture?.flow.responseHeaders = head.headers.map { .init(name: $0.name, value: $0.value) }
            owner.capture?.flow.contentType = head.headers["content-type"].first
            head.headers = proxyHeaders(head.headers, close: true)
            client.writeAndFlush(HTTPServerResponsePart.head(head), promise: nil)
        case .body(let buffer):
            guard !isInformational else {
                owner.fail(client, status: .badGateway, reason: "Invalid informational response body")
                context.close(promise: nil)
                return
            }
            owner.capture?.append(buffer, isRequest: false)
            client.writeAndFlush(HTTPServerResponsePart.body(.byteBuffer(buffer)), promise: nil)
            if !client.isWritable { context.channel.setOption(ChannelOptions.autoRead, value: false).whenFailure { _ in } }
        case .end:
            guard !isInformational else { return }
            completed = true; owner.capture?.finish()
            let upstream = context.channel
            client.writeAndFlush(HTTPServerResponsePart.end(nil)).whenComplete { _ in
                self.client.close(promise: nil); upstream.close(promise: nil)
            }
        }
    }
    func channelWritabilityChanged(context: ChannelHandlerContext) {
        client.setOption(ChannelOptions.autoRead, value: context.channel.isWritable).whenFailure { _ in }
        context.fireChannelWritabilityChanged()
    }
    func channelInactive(context: ChannelHandlerContext) {
        if !completed {
            owner.capture?.finish(error: "Upstream disconnected")
            if responseStarted { client.close(promise: nil) }
            else { owner.fail(client, status: .badGateway, reason: "Upstream disconnected") }
        }
        context.fireChannelInactive()
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) {
        owner.capture?.finish(error: "Upstream transport error")
        if responseStarted { client.close(promise: nil); context.close(promise: nil) }
        else { owner.fail(client, status: .badGateway, reason: "Upstream transport error") }
    }
    func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
        if event is IdleStateHandler.IdleStateEvent { owner.capture?.finish(error: "Upstream idle timeout"); client.close(promise: nil); context.close(promise: nil) }
        else { context.fireUserInboundEventTriggered(event) }
    }
}
