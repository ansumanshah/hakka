import Foundation
#if canImport(HakkaCommon)
import HakkaCommon
#endif

/// Immutable handoff from URLProtocol callbacks to the capture processing queue.
struct HakkaCompletedCapture: @unchecked Sendable {
    let requestId: String
    let request: URLRequest
    let requestBodyData: Data?
    let startTime: Int64
    let receivedResponse: URLResponse?
    let receivedData: Data
    let receivedBodySize: Int64
    let taskMetrics: URLSessionTaskMetrics?
    let error: Error?
    let source: RequestSource
    /// Trace correlation id injected into the outgoing request as `x-hakka-trace`.
    /// Non-nil when `HakkaConfig.traceEnabled` is `true` and the request host qualifies.
    let correlationId: String?
}

/// Serializes completed-request processing so URLProtocol delegate callbacks
/// only deliver bytes/status to the URL loading client.
final class HakkaCaptureProcessor: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.capture-processing", qos: .utility)
    private let queueKey = DispatchSpecificKey<Void>()

    init() {
        queue.setSpecific(key: queueKey, value: ())
    }

    func enqueue(_ capture: HakkaCompletedCapture, interceptor: HakkaInterceptor) {
        queue.async { [weak interceptor] in
            guard let interceptor else { return }
            if let url = capture.request.url, interceptor.shouldIgnore(url: url) {
                return
            }

            let request: NetworkRequest
            switch capture.source {
            case .mock:
                request = Self.buildMockRequest(from: capture, interceptor: interceptor)
            default:
                request = RequestBuilder.build(
                    requestId: capture.requestId,
                    request: capture.request,
                    requestBodyData: capture.requestBodyData,
                    startTime: capture.startTime,
                    receivedResponse: capture.receivedResponse,
                    receivedData: capture.receivedData,
                    receivedBodySize: capture.receivedBodySize,
                    taskMetrics: capture.taskMetrics,
                    error: capture.error,
                    interceptor: interceptor,
                    correlationId: capture.correlationId
                )
            }
            interceptor.commitProcessedCapture(request)
        }
    }

    func enqueue(_ request: NetworkRequest, interceptor: HakkaInterceptor) {
        queue.async { [weak interceptor] in
            interceptor?.commitProcessedCapture(request)
        }
    }

    func sync() {
        if DispatchQueue.getSpecific(key: queueKey) != nil {
            return
        }
        queue.sync {}
    }

    private static func buildMockRequest(
        from capture: HakkaCompletedCapture,
        interceptor: HakkaInterceptor
    ) -> NetworkRequest {
        let httpResponse = capture.receivedResponse as? HTTPURLResponse
        let responseHeadersRaw = RequestBuilder.splitMultiValueHeaders(
            (httpResponse?.allHeaderFields ?? [:]).reduce(into: [:]) { result, pair in
                if let key = pair.key as? String, let value = pair.value as? String {
                    result[key] = [value]
                }
            }
        )
        let requestHeadersRaw = RequestBuilder.splitMultiValueHeaders(
            (capture.request.allHTTPHeaderFields ?? [:]).reduce(into: [:]) { result, pair in
                result[pair.key] = [pair.value]
            }
        )

        let requestHeaders = interceptor.redactHeaders(requestHeadersRaw)
        let responseHeaders = interceptor.redactHeaders(responseHeadersRaw)
        let requestContentType = requestHeaders.firstValue("Content-Type")
        let responseContentType = responseHeaders.firstValue("Content-Type")

        let (rawReqBody, reqBodySize) = interceptor.captureBody(
            capture.requestBodyData ?? capture.request.httpBody,
            contentType: requestContentType
        )
        let (rawResBody, capturedResBodySize) = interceptor.captureBody(capture.receivedData, contentType: responseContentType)
        let reqBody = interceptor.redactBodyFields(rawReqBody, contentType: requestContentType)
        let resBody = interceptor.redactBodyFields(rawResBody, contentType: responseContentType)
        let resBodySize = max(capture.receivedBodySize, capturedResBodySize)
        let url = capture.request.url?.absoluteString ?? ""

        return NetworkRequest(
            id: capture.requestId,
            url: interceptor.redactQueryItems(in: url),
            method: HttpMethod(rawString: capture.request.httpMethod ?? "GET"),
            status: httpResponse.map { Int($0.statusCode) },
            startTime: capture.startTime,
            duration: Int64(Date().timeIntervalSince1970 * 1000) - capture.startTime,
            requestHeaders: requestHeaders,
            responseHeaders: responseHeaders,
            requestBodySize: reqBodySize,
            responseBodySize: resBodySize,
            requestBody: reqBody,
            responseBody: resBody,
            error: capture.error?.localizedDescription,
            source: .mock,
            graphqlOperationName: HakkaInterceptor.extractGraphQLOperationName(
                contentType: requestContentType,
                body: reqBody,
                url: url
            )
        )
    }
}
