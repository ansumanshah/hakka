import Foundation
import NIOCore
import NIOHTTP1

struct ProxyAuthority: Sendable, Equatable {
    let host: String
    let port: Int
    var header: String { host.contains(":") ? "[\(host)]:\(port)" : "\(host):\(port)" }

    static func parse(_ value: String, defaultPort: Int? = nil) throws -> Self {
        guard !value.isEmpty, !value.contains(where: { $0.isWhitespace }),
              !value.contains("@"), !value.contains("/"), !value.contains("?"), !value.contains("#") else {
            throw ProxyTransportError.invalidRequest
        }
        let host: String
        let portText: String?
        if value.hasPrefix("[") {
            guard let end = value.firstIndex(of: "]") else { throw ProxyTransportError.invalidRequest }
            host = String(value[value.index(after: value.startIndex)..<end])
            let rest = value[value.index(after: end)...]
            guard rest.isEmpty || rest.hasPrefix(":") else { throw ProxyTransportError.invalidRequest }
            portText = rest.isEmpty ? nil : String(rest.dropFirst())
        } else {
            let parts = value.split(separator: ":", omittingEmptySubsequences: false)
            guard parts.count <= 2 else { throw ProxyTransportError.invalidRequest }
            host = String(parts[0]); portText = parts.count == 2 ? String(parts[1]) : nil
        }
        guard !host.isEmpty, let port = portText.flatMap(Int.init) ?? (portText == nil ? defaultPort : nil),
              (1...65535).contains(port) else { throw ProxyTransportError.invalidRequest }
        return .init(host: host.lowercased(), port: port)
    }
}

enum ProxyTransportError: Error { case invalidRequest, unsupportedProtocol, bufferLimit, stopped }

func proxyHeaders(_ headers: HTTPHeaders, close: Bool = false) -> HTTPHeaders {
    let nominated = headers["connection"].flatMap { $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() } }
    let removed = Set(nominated + ["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"])
    var result = HTTPHeaders(headers.filter { !removed.contains($0.name.lowercased()) }.map { ($0.name, $0.value) })
    if close { result.replaceOrAdd(name: "Connection", value: "close") }
    return result
}

func proxyDecoder() -> ByteToMessageHandler<HTTPRequestDecoder> {
    var limits = NIOHTTPDecoderLimitConfiguration()
    limits.maxHeaderFieldSize = 8192; limits.maxHeaderListSize = 32768; limits.maxHeaderFieldCount = 100
    return ByteToMessageHandler(HTTPRequestDecoder(leftOverBytesStrategy: .forwardBytes, limitConfiguration: limits))
}

func proxyResponseDecoder() -> ByteToMessageHandler<HTTPResponseDecoder> {
    var limits = NIOHTTPDecoderLimitConfiguration()
    limits.maxHeaderFieldSize = 8192; limits.maxHeaderListSize = 32768; limits.maxHeaderFieldCount = 100
    return ByteToMessageHandler(HTTPResponseDecoder(informationalResponseStrategy: .forward, limitConfiguration: limits))
}

final class ProxyCapture: @unchecked Sendable {
    var flow: ProxyFlow
    private var request = Data()
    private var response = Data()
    private let configuration: ProxyConfiguration
    private var emitted = false
    init(head: HTTPRequestHead, url: String, configuration: ProxyConfiguration) {
        self.configuration = configuration
        flow = ProxyFlow(startedAt: Date().timeIntervalSince1970 * 1000, endedAt: 0,
                         method: head.method.rawValue, url: url,
                         requestHeaders: head.headers.map { .init(name: $0.name, value: $0.value) },
                         httpVersion: "HTTP/\(head.version.major).\(head.version.minor)")
    }
    func append(_ buffer: ByteBuffer, isRequest: Bool) {
        let count = buffer.readableBytes
        if isRequest {
            flow.requestBodySize += count
            request.append(contentsOf: buffer.readableBytesView.prefix(max(0, configuration.maxBodyBytes - request.count)))
        } else {
            flow.responseBodySize += count
            response.append(contentsOf: buffer.readableBytesView.prefix(max(0, configuration.maxBodyBytes - response.count)))
        }
    }
    func finish(error: String? = nil) {
        guard !emitted else { return }; emitted = true
        flow.endedAt = Date().timeIntervalSince1970 * 1000; flow.error = error
        flow.requestBody = request.isEmpty ? nil : String(data: request, encoding: .utf8)
        flow.responseBody = response.isEmpty ? nil : String(data: response, encoding: .utf8)
        flow.requestBodyTruncated = flow.requestBodySize > request.count
        flow.responseBodyTruncated = flow.responseBodySize > response.count
        configuration.recorder.emit(flow)
    }
}
