import NIOCore

/// Each relay and its peer run on the same event loop; writability bounds socket buffering.
final class ProxyTunnelRelay: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer
    let peer: any Channel
    let capture: ProxyCapture?
    private var ended = false
    init(peer: any Channel, capture: ProxyCapture? = nil) { self.peer = peer; self.capture = capture }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let source = context.channel
        peer.writeAndFlush(unwrapInboundIn(data)).whenFailure { _ in
            source.close(promise: nil); self.peer.close(promise: nil)
        }
        if !peer.isWritable { context.channel.setOption(ChannelOptions.autoRead, value: false).whenFailure { _ in } }
    }
    func channelWritabilityChanged(context: ChannelHandlerContext) {
        peer.setOption(ChannelOptions.autoRead, value: context.channel.isWritable).whenFailure { _ in }
        context.fireChannelWritabilityChanged()
    }
    func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
        if let event = event as? ChannelEvent, event == .inputClosed {
            peer.close(mode: .output, promise: nil)
            context.fireUserInboundEventTriggered(event)
        } else if event is IdleStateHandler.IdleStateEvent {
            capture?.finish(error: "Tunnel idle timeout"); peer.close(promise: nil); context.close(promise: nil)
        } else { context.fireUserInboundEventTriggered(event) }
    }
    func channelInactive(context: ChannelHandlerContext) {
        if !ended { ended = true; capture?.finish() }
        peer.close(promise: nil); context.fireChannelInactive()
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) {
        capture?.finish(error: "Tunnel transport error"); peer.close(promise: nil); context.close(promise: nil)
    }
}
