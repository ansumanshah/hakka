import Foundation
import Security
#if canImport(HakkaCommon)
import HakkaCommon
#endif

/// `HakkaURLProtocol` is a `URLProtocol` subclass that intercepts all
/// `NSURLSession` HTTP/HTTPS requests and forwards them to the `HakkaInterceptor`
/// event bus for capture, timing analysis, and streaming to the desktop companion.
///
/// ## How it works
/// 1. Registered via `URLProtocol.registerClass(_:)` when `HakkaInterceptor.start()` is called.
/// 2. Swizzling of `URLSessionConfiguration.default` and `.ephemeral` ensures that
///    sessions created *after* `start()` also have the protocol injected.
/// 3. Each intercepted request is forwarded through an inner `URLSession` (with
///    `HakkaURLProtocol` stripped to prevent recursion).
/// 4. Timing data is extracted from `URLSessionTaskMetrics` (DNS, TLS, TCP, TTFB, download).
/// 5. Completed requests are dispatched to `HakkaInterceptor.didCapture(_:)`.
///
/// ## Registration
/// You do **not** need to instantiate this class directly. Use `HakkaInterceptor`:
/// ```swift
/// HakkaInterceptor.shared.start()
/// ```
///
/// ## Known gap: background sessions
/// `URLSessionConfiguration.background(withIdentifier:)` is not, and cannot
/// be, covered by this class. iOS hands background transfers to the
/// `nsurlsessiond` system daemon, which runs out-of-process and never
/// consults `URLProtocol.protocolClasses` — this holds even before the app
/// suspends, not only after. Hakka swizzles `background(withIdentifier:)`
/// to detect that the app created one and logs a warning (see
/// `reportBackgroundSessionDetected(identifier:)`) rather than missing the
/// traffic silently, but the traffic itself is not captured.
public final class HakkaURLProtocol: URLProtocol, @unchecked Sendable {

    /// Reference to the owning interceptor, set by `HakkaInterceptor.start()`.
    /// Setting this to a non-nil value also installs the background-session
    /// detection swizzle (see `installBackgroundSessionDetectionIfNeeded()`
    /// below) — piggybacking on this assignment, the first line of `start()`,
    /// means the detection swizzle goes live wherever `.default`/`.ephemeral`
    /// swizzling already does, with no separate call site needed.
    static var interceptor: HakkaInterceptor? {
        get { interceptorStorage }
        set {
            interceptorStorage = newValue
            if newValue != nil {
                installBackgroundSessionDetectionIfNeeded()
            }
        }
    }
    nonisolated(unsafe) private static weak var interceptorStorage: HakkaInterceptor?

    /// Tag key used to mark requests that have already been intercepted,
    /// preventing recursive interception through the inner session.
    private static let interceptedKey = "com.noodleapps.hakka.intercepted"

    private var requestId = UUID().uuidString
    fileprivate var dataTask: URLSessionDataTask?
    private var receivedData = Data()
    /// Full, untruncated response bytes accumulated while either a response-phase
    /// breakpoint pause buffers delivery (`responsePhasePending`) or a rewrite-mode
    /// mock rule (`pendingRewriteRule`) is transforming the response — the two
    /// branches are mutually exclusive (see the `pendingRewriteRule` check in
    /// `didReceive response:` below). `receivedData` above is capped at
    /// `currentBodyCaptureLimit()` for storage/inspection — both paths must still
    /// deliver/transform every byte the real response sent, not that capped copy.
    private var fullResponseData = Data()
    private var receivedBodySize: Int64 = 0
    private var receivedResponse: URLResponse?
    private var bodyCaptureLimit: Int?
    private var startTime: Int64 = 0
    private var taskMetrics: URLSessionTaskMetrics?
    private var captureRequest: URLRequest?
    private var captureRequestBodyData: Data?
    private let stateLock = NSLock()
    private var stoppedLoading = false
    private var completedLoading = false
    private lazy var throttleQueue = DispatchQueue(label: "com.noodleapps.hakka.throttle.\(requestId)", qos: .userInitiated)
    /// Trace id injected as `x-hakka-trace` on the outgoing request. Non-nil when
    /// `HakkaConfig.traceEnabled` is `true` and the request host qualifies.
    private var correlationId: String?
    /// When a response-phase breakpoint is active, client delivery is buffered until completion.
    private var responsePhasePending = false
    /// Set once the first chunk of this response has gone through `dripThrottled`.
    /// Checked alongside `ThrottleEngine.shared.isActive` in `didReceive data:` so that if
    /// throttling is deactivated mid-transfer, later chunks still route through the same
    /// serial `throttleQueue` as earlier ones instead of delivering immediately and
    /// overtaking bytes still asleep on the queue.
    private var isDripping = false
    /// Set when a matched `MockRule` routes this request through the
    /// passthrough-then-transform path (`redirectTo` and/or `modify`). The real
    /// response is buffered (never streamed incrementally) so `modify`'s
    /// status/header/body edits can be applied to it before client delivery —
    /// mirrors `applyRewriteResponse` in `MockEngine.ts`.
    private var pendingRewriteRule: MockRule?

    /// Opts a single request out of Hakka capture entirely; stripped before
    /// the request leaves so it never reaches the remote server.
    private static let ignoreHeaderName = "x-hakka-ignore"

    /// Request/response header that carries the per-request trace correlation id.
    /// Matches the canonical header name defined in `packages/hakka-core/src/engine/trace.ts`.
    private static let traceHeaderName = "x-hakka-trace"

    // MARK: - Background session detection
    //
    // Background `URLSessionConfiguration`s are structurally invisible to this
    // file's interception: their transfers are handed to Apple's `nsurlsessiond`
    // system daemon and run out-of-process, which never consults
    // `URLProtocol.protocolClasses` — true even while the host app is in the
    // foreground, not only after it suspends. There is no fix for that from a
    // `URLProtocol` subclass. What `URLSessionSwizzle.swift`'s swizzle of the
    // `background(withIdentifier:)` factory method CAN do is detect that the
    // app created one, so this reports it as a warning instead of a silent gap.

    /// Background session identifiers already warned about, so a host app
    /// that calls `.background(withIdentifier:)` repeatedly for the same
    /// identifier (the normal re-attach-after-relaunch pattern) doesn't flood
    /// the log store with duplicate warnings.
    private static let backgroundWarningLock = NSLock()
    private nonisolated(unsafe) static var warnedBackgroundIdentifiers = Set<String>()

    /// Called from the swizzled `URLSessionConfiguration.background(withIdentifier:)`
    /// whenever the host app creates a background session configuration.
    /// Routes through the same structured-log pipeline the Logs inspector
    /// panel and bridge console already surface (`HakkaInterceptor.logWarn`),
    /// once per distinct identifier.
    static func reportBackgroundSessionDetected(identifier: String) {
        backgroundWarningLock.lock()
        let alreadyWarned = warnedBackgroundIdentifiers.contains(identifier)
        warnedBackgroundIdentifiers.insert(identifier)
        backgroundWarningLock.unlock()
        guard !alreadyWarned else { return }

        interceptor?.logWarn(
            "Background URLSession '\(identifier)' will not be captured. iOS hands its uploads and downloads to a system daemon that runs out of process, so Hakka's URLProtocol interception never sees them. Nothing about this session will appear in the inspector.",
            category: "capture"
        )
    }

    /// Shared inner session strips HakkaURLProtocol from the config to prevent recursive interception.
    private static let innerSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.protocolClasses = config.protocolClasses?.filter { $0 != HakkaURLProtocol.self }
        return URLSession(configuration: config, delegate: HakkaURLSessionRouter.shared, delegateQueue: nil)
    }()

    /// Only intercepts HTTP/HTTPS requests that haven't already been tagged.
    /// Requests carrying an `x-hakka-ignore` header are passed through without
    /// capture — the header is stripped in `startLoading` so it never reaches
    /// the remote server.
    public override class func canInit(with request: URLRequest) -> Bool {
        guard
            URLProtocol.property(forKey: interceptedKey, in: request) == nil,
            request.cachePolicy != .returnCacheDataDontLoad,
            request.value(forHTTPHeaderField: ignoreHeaderName) == nil,
            let url = request.url,
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            let interceptor = interceptor,
            interceptor.isRunning,
            !interceptor.shouldIgnore(url: url)
        else { return false }
        return true
    }

    public override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }

    /// Begin loading: tag the request, start the inner session task.
    /// If a `MockEngine` rule matches, the mock response is returned
    /// without hitting the network.
    ///
    /// Header management performed here:
    /// - `x-hakka-ignore`: stripped before the request is forwarded (never leaks to server).
    /// - `x-hakka-trace`: injected when `HakkaConfig.traceEnabled` is `true` and the request
    ///   host qualifies under `tracePropagateOrigins`. The generated UUID is also stored as
    ///   `correlationId` on the resulting `NetworkRequest` for cross-layer correlation.
    public override func startLoading() {
        let mutable = (request as NSURLRequest).mutableCopy() as! NSMutableURLRequest
        URLProtocol.setProperty(true, forKey: Self.interceptedKey, in: mutable)

        mutable.setValue(nil, forHTTPHeaderField: Self.ignoreHeaderName)

        if let interceptor = Self.interceptor,
           let host = request.url?.host,
           interceptor.config.shouldInjectTrace(for: host) {
            let traceId = UUID().uuidString
            mutable.setValue(traceId, forHTTPHeaderField: Self.traceHeaderName)
            self.correlationId = traceId
        }

        startTime = Int64(Date().timeIntervalSince1970 * 1000)
        bodyCaptureLimit = currentBodyCaptureLimit()

        let urlString = request.url?.absoluteString ?? ""
        let httpMethod = request.httpMethod ?? "GET"

        // `failure` takes priority over `block`, which takes priority over
        // `redirectTo`/`modify` (mirrors `MockEngine.ts`'s fetch-interceptor
        // ordering: failure, then block, then isRewrite). A rewrite-mode rule
        // (`redirectTo` and/or `modify`) issues the real request through the
        // passthrough-then-transform path; anything else is served wholesale
        // from `response`.
        if let rule = MockEngine.shared.match(url: urlString, method: httpMethod) {
            if let failure = rule.failure {
                prepareBodyStreamForCaptureIfSafe(mutableRequest: mutable, allowUnknownLength: true)
                serveFailureResponse(rule: rule, failure: failure)
                return
            }
            if rule.block {
                prepareBodyStreamForCaptureIfSafe(mutableRequest: mutable, allowUnknownLength: true)
                serveBlockedResponse(rule: rule)
                return
            }
            if rule.isRewrite {
                applyRequestModify(rule: rule, mutable: mutable)
                prepareBodyStreamForCaptureIfSafe(mutableRequest: mutable, allowUnknownLength: false)
                pendingRewriteRule = rule
                issueDataTask(request: mutable as URLRequest)
                return
            }
            prepareBodyStreamForCaptureIfSafe(mutableRequest: mutable, allowUnknownLength: true)
            serveMockResponse(rule: rule)
            return
        }

        prepareBodyStreamForCaptureIfSafe(mutableRequest: mutable, allowUnknownLength: false)

        // Value-type snapshot taken after every mutation above — the async closures
        // below are @Sendable and must not capture the NSMutableURLRequest reference.
        let outgoing = mutable as URLRequest

        // Pause on a background thread before issuing the dataTask — never block the main thread.
        if BreakpointEngine.shared.matchesRequest(url: urlString, method: httpMethod) {
            let reqHeaders = (mutable.allHTTPHeaderFields ?? [:]).filter { !$0.key.hasPrefix("x-hakka") }
            let bodyText = mutable.httpBody.flatMap { String(data: $0, encoding: .utf8) }
            let snapshot = PausedRequest(
                url: urlString,
                method: httpMethod,
                headers: reqHeaders,
                body: bodyText
            )
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                let action = BreakpointEngine.shared.pauseRequest(
                    url: urlString,
                    method: httpMethod,
                    requestId: self.requestId,
                    request: snapshot
                )
                switch action {
                case .abort:
                    self.stateLock.lock()
                    let stopped = self.stoppedLoading
                    self.stateLock.unlock()
                    if !stopped {
                        let err = NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled, userInfo: nil)
                        self.client?.urlProtocol(self, didFailWithError: err)
                        self.enqueueCompletion(error: err)
                    }
                case .resume(let edits):
                    let edited = edits.map { Self.applyRequestBreakpointEdits($0, to: outgoing) } ?? outgoing
                    self.issueDataTask(request: edited)
                }
            }
            return
        }

        if ThrottleEngine.shared.isOffline {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                self.stateLock.lock()
                let stopped = self.stoppedLoading
                self.stateLock.unlock()
                guard !stopped else { return }
                let err = NSError(
                    domain: NSURLErrorDomain,
                    code: NSURLErrorNotConnectedToInternet,
                    userInfo: [NSLocalizedDescriptionKey: "The network connection was lost. (Hakka offline throttle)"]
                )
                self.client?.urlProtocol(self, didFailWithError: err)
                Self.interceptor?.removeInFlight(id: self.requestId)
            }
            return
        }

        if ThrottleEngine.shared.isActive {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                ThrottleEngine.shared.applyLatency()
                self.stateLock.lock()
                let stopped = self.stoppedLoading
                self.stateLock.unlock()
                guard !stopped else { return }
                self.issueDataTask(request: outgoing)
            }
            return
        }

        issueDataTask(request: outgoing)
    }

    /// Apply a request-phase breakpoint's URL/body edits to `outgoing`. Kept as
    /// a standalone (non-`private`) static function — rather than inlined in
    /// `startLoading`'s `.resume` case — so the `Content-Length` recompute
    /// below is directly testable without driving the full async
    /// `BreakpointEngine` pause/resume round-trip through a live network call.
    static func applyRequestBreakpointEdits(_ edits: PausedRequest, to outgoing: URLRequest) -> URLRequest {
        var edited = outgoing
        if let newURL = URL(string: edits.url) {
            edited.url = newURL
        }
        if let newBody = edits.body {
            let newBodyData = newBody.data(using: .utf8)
            edited.httpBody = newBodyData
            // Keep Content-Length truthful: a stale value left over from the
            // original (pre-edit) body would otherwise describe a different
            // length than what's actually sent. `setValue(_:forHTTPHeaderField:)`
            // is case-insensitive.
            edited.setValue(String(newBodyData?.count ?? 0), forHTTPHeaderField: "Content-Length")
        }
        return edited
    }

    /// Issue the inner URLSession dataTask after any request-phase processing.
    private func issueDataTask(request: URLRequest) {
        if let interceptor = Self.interceptor {
            let pending = NetworkRequest(
                id: requestId,
                url: request.url?.absoluteString ?? "",
                method: HttpMethod(rawString: request.httpMethod ?? "GET"),
                startTime: startTime,
                source: .urlSession
            )
            interceptor.registerInFlight(pending)
        }
        let task = Self.innerSession.dataTask(with: request)
        self.dataTask = task
        HakkaURLSessionRouter.shared.register(self, for: task)
        task.resume()
    }

    // MARK: - Mock response

    /// Serve a mocked response from a matched `MockRule`.
    /// Reports the request to `HakkaInterceptor` with `source: .mock`.
    private func serveMockResponse(rule: MockRule) {
        let deliver: @Sendable () -> Void = { [weak self] in
            guard let self else { return }
            guard self.beginCompletion() else { return }

            let url = self.request.url ?? URL(string: "about:blank")!
            let headerFields = rule.response.httpHeaderFields
            let httpResponse = HTTPURLResponse(
                url: url,
                statusCode: rule.response.status,
                httpVersion: "HTTP/1.1",
                headerFields: headerFields
            )!

            self.client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .notAllowed)

            var bodyData: Data?
            if let bodyString = rule.response.body {
                bodyData = bodyString.data(using: .utf8)
                if let data = bodyData {
                    self.client?.urlProtocol(self, didLoad: data)
                }
            }

            self.client?.urlProtocolDidFinishLoading(self)

            if let interceptor = Self.interceptor {
                interceptor.enqueueCompletedCapture(
                    HakkaCompletedCapture(
                        requestId: self.requestId,
                        request: self.captureRequest ?? self.request,
                        requestBodyData: self.captureRequestBodyData,
                        startTime: self.startTime,
                        receivedResponse: httpResponse,
                        receivedData: bodyData ?? Data(),
                        receivedBodySize: Int64(bodyData?.count ?? 0),
                        taskMetrics: nil,
                        error: nil,
                        source: .mock,
                        correlationId: self.correlationId
                    )
                )
            }
        }

        let totalDelay = rule.response.delay + MockEngine.shared.getGlobalDelay()

        if totalDelay > 0 {
            DispatchQueue.global(qos: .userInitiated).asyncAfter(
                deadline: .now() + totalDelay,
                execute: deliver
            )
        } else {
            deliver()
        }
    }

    // MARK: - Block

    /// Serve a `block`-mode rule: abort with a network-error-shaped failure
    /// before any real request goes out, and record it as a completed capture
    /// (mirrors `MockEngine.ts`'s fetch-interceptor block path — the blocked
    /// request still shows up in the inspector with `error: "Blocked by Hakka"`).
    private func serveBlockedResponse(rule: MockRule) {
        guard beginCompletion() else { return }

        let err = NSError(
            domain: NSURLErrorDomain,
            code: NSURLErrorNotConnectedToInternet,
            userInfo: [NSLocalizedDescriptionKey: "Blocked by Hakka"]
        )
        self.client?.urlProtocol(self, didFailWithError: err)

        if let interceptor = Self.interceptor {
            interceptor.enqueueCompletedCapture(
                HakkaCompletedCapture(
                    requestId: self.requestId,
                    request: self.captureRequest ?? self.request,
                    requestBodyData: self.captureRequestBodyData,
                    startTime: self.startTime,
                    receivedResponse: nil,
                    receivedData: Data(),
                    receivedBodySize: 0,
                    taskMetrics: nil,
                    error: err,
                    source: .mock,
                    correlationId: self.correlationId
                )
            )
        }
    }

    // MARK: - Failure

    /// Serve a `failure`-mode rule: abort with the specific `URLError.Code`
    /// the failure declares, before any real request goes out — a more
    /// precise simulation than `block`'s generic "not connected" error
    /// (mirrors `MockEngine.ts`'s fetch-interceptor failure path).
    private func serveFailureResponse(rule: MockRule, failure: MockFailure) {
        guard beginCompletion() else { return }

        let err = NSError(
            domain: NSURLErrorDomain,
            code: failure.code.urlErrorCode,
            userInfo: [NSLocalizedDescriptionKey: failure.code.message]
        )
        self.client?.urlProtocol(self, didFailWithError: err)

        if let interceptor = Self.interceptor {
            interceptor.enqueueCompletedCapture(
                HakkaCompletedCapture(
                    requestId: self.requestId,
                    request: self.captureRequest ?? self.request,
                    requestBodyData: self.captureRequestBodyData,
                    startTime: self.startTime,
                    receivedResponse: nil,
                    receivedData: Data(),
                    receivedBodySize: 0,
                    taskMetrics: nil,
                    error: err,
                    source: .mock,
                    correlationId: self.correlationId
                )
            )
        }
    }

    // MARK: - Rewrite (redirectTo / modify)

    /// Apply the request-side portion of a rewrite-mode rule to the outgoing
    /// `NSMutableURLRequest`, BEFORE the request is captured/issued: `redirectTo`
    /// rewrites the URL first, then `modify`'s query/header edits apply on top
    /// of the (possibly redirected) URL — mirrors `MockEngine.ts`'s
    /// `applyRewriteRequest` ordering exactly.
    private func applyRequestModify(rule: MockRule, mutable: NSMutableURLRequest) {
        var urlString = mutable.url?.absoluteString ?? ""

        if let redirectTo = rule.redirectTo, !redirectTo.isEmpty {
            urlString = redirectTo
        }
        if let modify = rule.modify {
            urlString = MockRuleTransform.applyQueryEdits(
                url: urlString,
                set: modify.setQueryParams,
                remove: modify.removeQueryParams
            )
        }
        if urlString != (mutable.url?.absoluteString ?? ""), let newURL = URL(string: urlString) {
            mutable.url = newURL
        }

        // Per-field `setValue(_:forHTTPHeaderField:)` calls (case-insensitive
        // matching, same as the existing `x-hakka-ignore` strip above) —
        // deliberately NOT `mutable.allHTTPHeaderFields = editedMap`: Foundation
        // MERGES a new `allHTTPHeaderFields` dictionary into the existing headers
        // rather than replacing them wholesale, so a key simply absent from the
        // edited map (i.e. one this rule wants removed) would silently survive.
        if let modify = rule.modify {
            if let remove = modify.removeRequestHeaders {
                for header in remove {
                    mutable.setValue(nil, forHTTPHeaderField: header)
                }
            }
            if let set = modify.setRequestHeaders {
                for (key, value) in set {
                    mutable.setValue(value, forHTTPHeaderField: key)
                }
            }
        }
    }

    /// Apply a rewrite-mode rule's `modify` block to the buffered real response
    /// (status/header overrides + plain-string body find/replace), then deliver
    /// the transformed response/body to the client and record the completed
    /// capture. Called from `didCompleteWithError` once the full body has
    /// arrived — mirrors `MockEngine.ts`'s `applyRewriteResponse`.
    private func finishRewriteDelivery(rule: MockRule, httpResponse: HTTPURLResponse) {
        var status = httpResponse.statusCode
        var headers: [String: String] = [:]
        for (key, value) in httpResponse.allHeaderFields {
            if let k = key as? String, let v = value as? String { headers[k] = v }
        }
        // Built from `fullResponseData` (uncapped), not the size-capped `receivedData`
        // — a rewrite rule with no `modify.replaceBody` (or an empty one) falls
        // through to `finalData = ... ?? fullResponseData` below and must still
        // deliver every byte the real response sent, not a `maxBodySize`-truncated copy.
        var bodyText = String(data: fullResponseData, encoding: .utf8) ?? ""

        if let modify = rule.modify {
            status = modify.status ?? status
            headers = MockRuleTransform.applyHeaderEdits(
                headers: headers,
                set: modify.setResponseHeaders,
                remove: modify.removeResponseHeaders
            )
            bodyText = MockRuleTransform.applyBodyReplacements(body: bodyText, replacements: modify.replaceBody)
        }

        let finalData = bodyText.data(using: .utf8) ?? fullResponseData
        let finalResponse = HTTPURLResponse(
            url: httpResponse.url ?? request.url ?? URL(string: "about:blank")!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) ?? httpResponse

        receivedResponse = finalResponse
        receivedData = finalData
        receivedBodySize = Int64(finalData.count)

        client?.urlProtocol(self, didReceive: finalResponse, cacheStoragePolicy: .allowed)
        if !finalData.isEmpty {
            client?.urlProtocol(self, didLoad: finalData)
        }
        client?.urlProtocolDidFinishLoading(self)
        enqueueCompletion(error: nil)
    }

    public override func stopLoading() {
        markStopped()
        Self.interceptor?.removeInFlight(id: requestId)
        if let dataTask {
            HakkaURLSessionRouter.shared.unregister(dataTask)
            dataTask.cancel()
        }
        dataTask = nil
    }

    private func enqueueCompletion(error: Error?) {
        guard let interceptor = Self.interceptor else { return }
        interceptor.removeInFlight(id: requestId)

        interceptor.enqueueCompletedCapture(
            HakkaCompletedCapture(
                requestId: requestId,
                request: captureRequest ?? request,
                requestBodyData: captureRequestBodyData,
                startTime: startTime,
                receivedResponse: receivedResponse,
                receivedData: receivedData,
                receivedBodySize: receivedBodySize,
                taskMetrics: taskMetrics,
                error: error,
                source: .urlSession,
                correlationId: correlationId
            )
        )
    }

    private func beginCompletion() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !completedLoading else { return false }
        completedLoading = true
        return !stoppedLoading
    }

    private func markStopped() {
        stateLock.lock()
        stoppedLoading = true
        stateLock.unlock()
    }

    private func prepareBodyStreamForCaptureIfSafe(
        mutableRequest: NSMutableURLRequest,
        allowUnknownLength: Bool
    ) {
        guard mutableRequest.httpBody == nil,
              let bodyStream = mutableRequest.httpBodyStream
        else {
            captureRequest = mutableRequest as URLRequest
            captureRequestBodyData = mutableRequest.httpBody
            return
        }

        guard allowUnknownLength else {
            captureRequest = mutableRequest as URLRequest
            captureRequestBodyData = nil
            return
        }

        let limit = currentBodyCaptureLimit()
        let contentLength = mutableRequest.value(forHTTPHeaderField: "Content-Length").flatMap(Int.init)
        guard contentLength.map({ $0 <= limit }) ?? true else {
            captureRequest = mutableRequest as URLRequest
            captureRequestBodyData = nil
            return
        }

        guard let body = Self.readBodyStream(bodyStream, limit: limit) else {
            captureRequest = mutableRequest as URLRequest
            captureRequestBodyData = nil
            return
        }

        mutableRequest.httpBody = body
        mutableRequest.httpBodyStream = nil
        var requestSnapshot = mutableRequest as URLRequest
        requestSnapshot.httpBody = body
        requestSnapshot.httpBodyStream = nil
        captureRequest = requestSnapshot
        captureRequestBodyData = body
    }

    private static func readBodyStream(_ stream: InputStream, limit: Int) -> Data? {
        stream.open()
        defer { stream.close() }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read < 0 {
                return nil
            }
            if read == 0 {
                break
            }
            if data.count + read > limit {
                return nil
            }
            data.append(buffer, count: read)
        }
        return data
    }

    private func currentBodyCaptureLimit() -> Int {
        bodyCaptureLimit ?? Self.interceptor?.config.maxBodySize ?? 262_144
    }

    /// Deliver `data` to `client` in ~1 KB chunks paced at the ThrottleEngine bandwidth.
    /// Runs on `throttleQueue` (background); never touches the main thread.
    /// `self` is `@unchecked Sendable`, so capturing it across the async boundary is safe.
    private func dripThrottled(data: Data, client: URLProtocolClient) {
        let engine = ThrottleEngine.shared
        let kbps = engine.config.downloadKbps
        guard kbps > 0 || isDripping else {
            // Unlimited bandwidth under an active (non-none) profile, and no earlier
            // chunk of this response is mid-drip — deliver immediately. Once `isDripping`
            // is true, an earlier chunk may still be asleep on `throttleQueue`, so this
            // chunk must queue behind it too even if bandwidth has since gone unlimited —
            // otherwise it would overtake the earlier chunk and reorder the bytes.
            client.urlProtocol(self, didLoad: data)
            return
        }
        isDripping = true

        let chunkSize = ThrottleEngine.dripChunkSize
        throttleQueue.async { [self] in
            var offset = 0
            while offset < data.count {
                self.stateLock.lock()
                let stopped = self.stoppedLoading
                self.stateLock.unlock()
                guard !stopped else { return }

                let end = min(offset + chunkSize, data.count)
                let slice = data[offset..<end]
                client.urlProtocol(self, didLoad: slice)
                offset = end

                if offset < data.count {
                    let delayS = engine.delayForBytes(slice.count)
                    if delayS > 0 {
                        Thread.sleep(forTimeInterval: delayS)
                    }
                }
            }
        }
    }
}

// MARK: - URLSessionDataDelegate

extension HakkaURLProtocol: URLSessionDataDelegate {
    public func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        receivedResponse = response
        if receivedData.isEmpty, response.expectedContentLength > 0 {
            let expectedLength = min(Int64(currentBodyCaptureLimit()), response.expectedContentLength)
            if expectedLength <= Int64(Int.max) {
                receivedData.reserveCapacity(Int(expectedLength))
            }
        }
        // A rewrite-mode mock rule (redirectTo/modify) always buffers the full
        // response for `finishRewriteDelivery` to transform — takes priority
        // over response-phase breakpoint buffering (mutually exclusive: this
        // branch returns before the breakpoint check below can set
        // `responsePhasePending`).
        if pendingRewriteRule != nil {
            completionHandler(.allow)
            return
        }

        let urlString = response.url?.absoluteString ?? ""
        let httpMethod = captureRequest?.httpMethod ?? request.httpMethod ?? "GET"
        if BreakpointEngine.shared.matchesResponse(url: urlString, method: httpMethod) {
            responsePhasePending = true
            // Allow URLSession to stream the body for capture; client delivery is deferred.
            completionHandler(.allow)
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
        completionHandler(.allow)
    }

    public func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        receivedBodySize += Int64(data.count)
        let limit = currentBodyCaptureLimit()
        if receivedData.count < limit {
            let remaining = limit - receivedData.count
            receivedData.append(data.prefix(remaining))
        }
        if responsePhasePending {
            // Delivery is deferred until the pause resolves — buffer every byte
            // here, uncapped, so a plain resume can hand the client the real
            // response instead of the size-capped `receivedData` above.
            fullResponseData.append(data)
            return
        }
        if pendingRewriteRule != nil {
            // `finishRewriteDelivery` transforms the full response once it's
            // complete — buffer every byte here, uncapped, so a response larger
            // than `maxBodySize` isn't truncated before the rule's
            // `modify.replaceBody`/pass-through logic ever sees it.
            fullResponseData.append(data)
            return
        }

        if (ThrottleEngine.shared.isActive || isDripping), let client = self.client {
            dripThrottled(data: data, client: client)
        } else {
            client?.urlProtocol(self, didLoad: data)
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didFinishCollecting metrics: URLSessionTaskMetrics
    ) {
        taskMetrics = metrics
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard beginCompletion() else {
            HakkaURLSessionRouter.shared.unregister(task)
            return
        }
        HakkaURLSessionRouter.shared.unregister(task)

        // The full response is already buffered in receivedData (see
        // `didReceive response`/`didReceive data` above). On a transport error
        // (error != nil) there is no response to transform — fall through to
        // normal completion below, which records the error as usual.
        if let rewriteRule = pendingRewriteRule, error == nil, let httpResp = receivedResponse as? HTTPURLResponse {
            finishRewriteDelivery(rule: rewriteRule, httpResponse: httpResp)
            return
        }

        // All body bytes are buffered — capped in receivedData for the paused
        // preview/storage, uncapped in fullResponseData for delivery. Pause on
        // a background thread so the UI can inspect/edit, then deliver to the client.
        if responsePhasePending, error == nil, let httpResp = receivedResponse as? HTTPURLResponse {
            let bodyText = String(data: receivedData, encoding: .utf8) ?? ""
            var respHeaders: [String: String] = [:]
            for (k, v) in httpResp.allHeaderFields {
                if let ks = k as? String, let vs = v as? String { respHeaders[ks] = vs }
            }
            let snapshot = PausedResponse(status: httpResp.statusCode, headers: respHeaders, body: bodyText)
            let urlString = httpResp.url?.absoluteString ?? ""
            let httpMethod = captureRequest?.httpMethod ?? request.httpMethod ?? "GET"

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                let action = BreakpointEngine.shared.pauseResponse(
                    url: urlString,
                    method: httpMethod,
                    requestId: self.requestId,
                    response: snapshot
                )
                self.stateLock.lock()
                let stopped = self.stoppedLoading
                self.stateLock.unlock()
                guard !stopped else { return }

                switch action {
                case .abort:
                    let err = NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled, userInfo: nil)
                    self.client?.urlProtocol(self, didFailWithError: err)
                    self.enqueueCompletion(error: err)
                case .resume(let edits):
                    let finalResponse: HTTPURLResponse
                    let finalData: Data
                    if let edits {
                        let editedURL = httpResp.url ?? URL(string: "about:blank")!
                        let newStatus = edits.status
                        let editedBodyData = edits.body.data(using: .utf8) ?? Data()
                        // Keep Content-Length truthful against the edited body —
                        // `edits.headers` may still carry the pre-edit length.
                        let newHeaders = MockRuleTransform.applyHeaderEdits(
                            headers: edits.headers,
                            set: ["Content-Length": String(editedBodyData.count)],
                            remove: ["Content-Length"]
                        )
                        finalResponse = HTTPURLResponse(
                            url: editedURL,
                            statusCode: newStatus,
                            httpVersion: "HTTP/1.1",
                            headerFields: newHeaders
                        ) ?? httpResp
                        finalData = editedBodyData
                        self.receivedResponse = finalResponse
                        self.receivedData = finalData
                        self.receivedBodySize = Int64(finalData.count)
                    } else {
                        finalResponse = httpResp
                        finalData = self.fullResponseData
                    }
                    self.client?.urlProtocol(self, didReceive: finalResponse, cacheStoragePolicy: .allowed)
                    if !finalData.isEmpty {
                        self.client?.urlProtocol(self, didLoad: finalData)
                    }
                    self.client?.urlProtocolDidFinishLoading(self)
                    self.enqueueCompletion(error: nil)
                }
            }
            return
        }

        // Notify the URL loading system first, then capture — ensures the response
        // is fully consumed before delegate/onRequest callbacks fire.
        if let error = error {
            client?.urlProtocol(self, didFailWithError: error)
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
        enqueueCompletion(error: error)
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        let mutable = (request as NSURLRequest).mutableCopy() as! NSMutableURLRequest
        URLProtocol.setProperty(true, forKey: Self.interceptedKey, in: mutable)
        client?.urlProtocol(self, wasRedirectedTo: mutable as URLRequest, redirectResponse: response)
        completionHandler(mutable as URLRequest)
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        forward(challenge: challenge, completionHandler: completionHandler)
    }

    public func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        forward(challenge: challenge, completionHandler: completionHandler)
    }

    private func forward(
        challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        let wrapped = URLAuthenticationChallenge(
            authenticationChallenge: challenge,
            sender: HakkaAuthenticationChallengeSender(handler: completionHandler)
        )
        client?.urlProtocol(self, didReceive: wrapped)
    }
}

nonisolated(unsafe) private var hakkaURLSessionOwnerKey: UInt8 = 0

private final class HakkaURLSessionRouter: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = HakkaURLSessionRouter()

    func register(_ owner: HakkaURLProtocol, for task: URLSessionTask) {
        objc_setAssociatedObject(task, &hakkaURLSessionOwnerKey, owner, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    func unregister(_ task: URLSessionTask) {
        objc_setAssociatedObject(task, &hakkaURLSessionOwnerKey, nil, .OBJC_ASSOCIATION_ASSIGN)
    }

    private func owner(for task: URLSessionTask) -> HakkaURLProtocol? {
        objc_getAssociatedObject(task, &hakkaURLSessionOwnerKey) as? HakkaURLProtocol
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let owner = owner(for: dataTask) else {
            completionHandler(.allow)
            return
        }
        owner.urlSession(session, dataTask: dataTask, didReceive: response, completionHandler: completionHandler)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        owner(for: dataTask)?.urlSession(session, dataTask: dataTask, didReceive: data)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didFinishCollecting metrics: URLSessionTaskMetrics
    ) {
        owner(for: task)?.urlSession(session, task: task, didFinishCollecting: metrics)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        owner(for: task)?.urlSession(session, task: task, didCompleteWithError: error)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let owner = owner(for: task) else {
            completionHandler(request)
            return
        }
        owner.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request, completionHandler: completionHandler)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard let owner = owner(for: task) else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        owner.urlSession(session, task: task, didReceive: challenge, completionHandler: completionHandler)
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        completionHandler(.performDefaultHandling, nil)
    }
}

private final class HakkaAuthenticationChallengeSender: NSObject, URLAuthenticationChallengeSender, @unchecked Sendable {
    typealias Handler = (URLSession.AuthChallengeDisposition, URLCredential?) -> Void

    private let handler: Handler

    init(handler: @escaping Handler) {
        self.handler = handler
    }

    func use(_ credential: URLCredential, for challenge: URLAuthenticationChallenge) {
        handler(.useCredential, credential)
    }

    func continueWithoutCredential(for challenge: URLAuthenticationChallenge) {
        handler(.useCredential, nil)
    }

    func cancel(_ challenge: URLAuthenticationChallenge) {
        handler(.cancelAuthenticationChallenge, nil)
    }

    func performDefaultHandling(for challenge: URLAuthenticationChallenge) {
        handler(.performDefaultHandling, nil)
    }

    func rejectProtectionSpaceAndContinue(with challenge: URLAuthenticationChallenge) {
        handler(.rejectProtectionSpace, nil)
    }
}
