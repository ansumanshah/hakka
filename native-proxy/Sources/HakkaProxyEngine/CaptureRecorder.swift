import Foundation

/// Redaction happens before any observer, store or export receives a flow.
public final class CaptureRecorder: Sendable {
    private let receive: @Sendable (ProxyFlow) -> Void
    public init(receive: @escaping @Sendable (ProxyFlow) -> Void) { self.receive = receive }
    public func emit(_ flow: ProxyFlow) { receive(FlowRedactor.redact(flow)) }
}
