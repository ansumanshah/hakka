import Foundation
#if canImport(HakkaNative)
import HakkaNative
#endif
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif

@objc(RNHakkaCoreBridge)
public final class RNHakkaCoreBridge: NSObject, HakkaDelegate, @unchecked Sendable {
    @objc public static let shared = RNHakkaCoreBridge()
    @objc public static let requestNotificationName = "RNHakkaCoreBridgeRequest"

    private let interceptor = HakkaInterceptor.shared
    private let ruleLock = NSLock()
    private var blockedRuleIds: [String: String] = [:]
    private let performanceMonitor = RNHakkaPerformanceMonitor()
    /// Invalidates asynchronous mode-switch continuations when a newer show
    /// or hide request arrives. Accessed only from MainActor UI methods.
    private var uiPresentationGeneration = 0

    // -- Observability context (session identity, tags, breadcrumbs, traces) --
    // JS calls aren't guaranteed serialized, so guard mutable context with a lock.
    private let contextLock = NSLock()
    private var sessionUserId: String?
    private var sessionTags: [String: String] = [:]
    private var breadcrumbs: [BreadcrumbRecord] = []
    private var activeTraces: [String: ActiveTrace] = [:]
    private let maxBreadcrumbs = 100

    /// Mutable in-progress trace; finalized into an immutable `TraceRecord` on finish.
    private struct ActiveTrace {
        let name: String
        let traceId: String
        let spanId: String
        let startTime: Int64
        let sessionId: String?
        let tags: [String: String]
        var attributes: [String: String]
    }

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private override init() {
        super.init()
    }

    @objc public func start() {
        interceptor.delegate = self
        interceptor.start()
    }

    @objc public func stop() {
        interceptor.stop()
    }

    @objc public func isReady() -> Bool {
        interceptor.isRunning
    }

    @objc public func clearLogs() {
        interceptor.clear()
    }

    @objc public func pause() {
        interceptor.pause()
    }

    @objc public func resume() {
        interceptor.resume()
    }

    @objc public func getLogCount() -> Int {
        interceptor.store.count
    }

    @objc public func getPerformanceMetrics() -> [String: Any] {
        Self.dictionary(from: interceptor.networkMetricsSummary())
    }

    @objc public func getLogs() -> [[String: Any]] {
        interceptor.store.requests.reversed().map(Self.dictionary(from:))
    }

    @objc public func exportJson() -> String {
        let payload = getLogs()
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else { return "[]" }
        return json
    }

    @objc public func exportHar() -> String {
        HarExporter.export(interceptor.store.requests, prettyPrint: false) ?? "{}"
    }

    @objc public func exportCurl(_ requestId: String) -> String {
        guard let request = interceptor.store.request(byId: requestId) else { return "" }
        return CurlExporter.export(request)
    }

    @objc public func getHealthReport() -> [String: Any] {
        contextLock.lock()
        let uid = sessionUserId
        let tags = sessionTags
        contextLock.unlock()
        let network = interceptor.healthReport(sessionId: uid, tags: tags)
        return Self.dictionary(from: Self.mergedHealthReport(
            network: network,
            performance: performanceMonitor.healthReport()
        ))
    }

    @objc public func setSensitiveHeaders(_ headers: [String]) {
        let normalized = Set(headers.map { $0.lowercased() })
        interceptor.updateConfig { $0.replacing(redactHeaders: normalized) }
    }

    @objc public func getSensitiveHeaders() -> [String] {
        Array(interceptor.config.redactHeaders).sorted()
    }

    @objc public func setIgnoredHosts(_ hosts: [String]) {
        let normalized = Set(hosts.map { $0.lowercased() })
        interceptor.updateConfig { $0.replacing(ignoreHosts: normalized) }
    }

    @objc public func getIgnoredHosts() -> [String] {
        Array(interceptor.config.ignoreHosts).sorted()
    }

    @objc public func setIgnoredPatterns(_ patterns: [String]) {
        interceptor.updateConfig { $0.replacing(ignorePatterns: patterns) }
    }

    @objc public func getIgnoredPatterns() -> [String] {
        interceptor.config.ignorePatterns
    }

    @objc public func blockRequests(_ pattern: String) {
        ruleLock.lock()
        defer { ruleLock.unlock() }
        guard blockedRuleIds[pattern] == nil else { return }
        let id = MockEngine.shared.addRule(MockRuleInput(
            pattern: pattern,
            isRegex: true,
            method: nil,
            response: MockResponse(
                status: 503,
                headers: ["Content-Type": "application/json"],
                body: #"{"error":"Blocked by Hakka"}"#
            )
        ))
        blockedRuleIds[pattern] = id
    }

    @objc public func simulateSlowNetwork(_ delayMs: Double) {
        MockEngine.shared.setGlobalDelay(max(0.0, delayMs) / 1_000)
    }

    @objc public func unblockRequests(_ pattern: String) {
        ruleLock.lock()
        let id = blockedRuleIds.removeValue(forKey: pattern)
        ruleLock.unlock()
        if let id {
            MockEngine.shared.removeRule(id: id)
        }
    }

    @objc public func addMockRule(_ rule: NSDictionary) {
        guard
            let id = rule["id"] as? String,
            !id.isEmpty,
            let pattern = rule["pattern"] as? String,
            !pattern.isEmpty
        else { return }

        let response = MockResponse(
            status: Self.intValue(rule["status"]) ?? 200,
            headers: Self.stringMap(rule["headers"]),
            headerValues: Self.stringArrayMap(rule["headerValues"]),
            body: Self.stringValue(rule["body"]) ?? "",
            delay: max(0, (Self.doubleValue(rule["delayMs"]) ?? 0) / 1_000)
        )
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern: pattern,
                isRegex: Self.boolValue(rule["isRegex"]) ?? false,
                regexFlags: rule["regexFlags"] as? String,
                method: rule["method"] as? String,
                response: response,
                enabled: Self.boolValue(rule["enabled"]) ?? true,
                redirectTo: rule["redirectTo"] as? String,
                block: Self.boolValue(rule["block"]) ?? false,
                modify: Self.mockRuleModify(from: rule["modify"]),
                failure: Self.mockFailure(from: rule["failure"]),
                skipCount: Self.nonNegativeIntValue(rule["skipCount"]) ?? 0,
                stopAfter: Self.nonNegativeIntValue(rule["stopAfter"])
            ),
            id: id
        )
    }

    @objc public func removeMockRule(_ id: String) {
        MockEngine.shared.removeRule(id: id)
    }

    @objc public func setMockRuleEnabled(_ id: String, enabled: Bool) {
        if enabled {
            MockEngine.shared.enableRule(id: id)
        } else {
            MockEngine.shared.disableRule(id: id)
        }
    }

    /// The React Native pod includes the canonical inspector in both binary and source builds.
    @objc public func isUIAvailable() -> Bool {
        true
    }

    @MainActor @objc public func showUI(_ mode: String, completion: @escaping (Bool) -> Void) {
        guard interceptor.isRunning, ["bubble", "sheet", "fullscreen"].contains(mode) else {
            completion(false)
            return
        }
        uiPresentationGeneration += 1
        let generation = uiPresentationGeneration
        let isCurrentPresentation: () -> Bool = {
            self.uiPresentationGeneration == generation && self.interceptor.isRunning
        }
        let finish: (Bool) -> Void = { presented in
            completion(isCurrentPresentation() ? presented : false)
        }
        let presentOverlay: (@escaping (Bool) -> Void) -> Void = { done in
            guard isCurrentPresentation() else {
                finish(false)
                return
            }
            if mode == "fullscreen" {
                OverlayWindow.shared.showFullscreen(completion: done)
            } else {
                OverlayWindow.shared.show(completion: done)
            }
        }
        if mode == "fullscreen" {
            OverlayWindow.shared.showFullscreen { isCorrectMode in
                guard isCurrentPresentation() else { finish(false); return }
                guard !isCorrectMode else { finish(true); return }
                OverlayWindow.shared.hide { dismissed in
                    guard isCurrentPresentation(), dismissed else { finish(false); return }
                    presentOverlay(finish)
                }
            }
        } else if mode == "sheet" {
            OverlayWindow.shared.show { isCorrectMode in
                guard isCurrentPresentation() else { finish(false); return }
                guard !isCorrectMode else { finish(true); return }
                OverlayWindow.shared.hide { dismissed in
                    guard isCurrentPresentation(), dismissed else { finish(false); return }
                    presentOverlay(finish)
                }
            }
        } else {
            OverlayWindow.shared.hide { dismissed in
                guard isCurrentPresentation(), dismissed else { finish(false); return }
                BubbleWindow.shared.show(completion: finish)
            }
        }
    }

    @MainActor @objc public func hideUI() {
        uiPresentationGeneration += 1
        OverlayWindow.shared.hide()
        BubbleWindow.shared.hide()
    }

    @objc public func getSnapshot() -> [[String: Any]] {
        getLogs()
    }

    // -- Observability: identity & tagging --

    @objc public func setUserId(_ userId: String?) {
        contextLock.lock()
        defer { contextLock.unlock() }
        sessionUserId = userId
    }

    @objc public func setTag(_ key: String, value: String) {
        contextLock.lock()
        defer { contextLock.unlock() }
        sessionTags[key] = value
    }

    @objc public func addBreadcrumb(_ name: String, attributes: NSDictionary) {
        let attrs = Self.stringMap(attributes)
        contextLock.lock()
        let crumb = BreadcrumbRecord(
            timestamp: Self.nowMs(),
            sessionId: sessionUserId,
            tags: sessionTags,
            name: name,
            attributes: attrs
        )
        if breadcrumbs.count >= maxBreadcrumbs { breadcrumbs.removeFirst() }
        breadcrumbs.append(crumb)
        contextLock.unlock()
        // Export through the same sink fan-out as captured network records.
        interceptor.inject(crumb)
    }

    // -- Observability: distributed tracing --

    @objc public func startTrace(_ name: String) -> String {
        let traceId = UUID().uuidString
        contextLock.lock()
        defer { contextLock.unlock() }
        activeTraces[traceId] = ActiveTrace(
            name: name,
            traceId: traceId,
            spanId: UUID().uuidString,
            startTime: Self.nowMs(),
            sessionId: sessionUserId,
            tags: sessionTags,
            attributes: [:]
        )
        return traceId
    }

    @objc public func setTraceAttribute(_ traceId: String, key: String, value: String) {
        contextLock.lock()
        defer { contextLock.unlock() }
        activeTraces[traceId]?.attributes[key] = value
    }

    @objc public func setTraceMetric(_ traceId: String, key: String, value: String) {
        contextLock.lock()
        defer { contextLock.unlock() }
        activeTraces[traceId]?.attributes["metric.\(key)"] = value
    }

    @objc public func finishTrace(_ traceId: String) {
        contextLock.lock()
        let active = activeTraces.removeValue(forKey: traceId)
        contextLock.unlock()
        guard let active else { return }
        // timestamp/startTime stay at the trace's start; only endTime is stamped
        // here. status is left unset — finishTrace carries no success/error signal.
        let trace = TraceRecord(
            timestamp: active.startTime,
            sessionId: active.sessionId,
            tags: active.tags,
            name: active.name,
            traceId: active.traceId,
            spanId: active.spanId,
            startTime: active.startTime,
            endTime: Self.nowMs(),
            attributes: active.attributes
        )
        interceptor.inject(trace)
    }

    public func hakkaDidCapture(_ request: NetworkRequest) {
        let payload = Self.dictionary(from: request)
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: Notification.Name(Self.requestNotificationName),
                object: nil,
                userInfo: payload
            )
        }
    }

    @objc public func enableNativeWebSocket() {
        interceptor.enableNativeWebSocket()
    }

    @objc public func isNativeCapturing() -> Bool {
        interceptor.isNativeWebSocketCapturing
    }

    private static func dictionary(from request: NetworkRequest) -> [String: Any] {
        let sourceWire: String
        switch request.source {
        case .nativeWebSocket:
            sourceWire = "native_ws"
        default:
            sourceWire = "native"
        }

        var payload: [String: Any] = [
            "id": request.id,
            "url": request.url,
            "method": request.method.rawValue,
            "startTime": request.startTime,
            "timestamp": request.startTime,
            "requestHeaders": flatten(request.requestHeaders),
            "responseHeaders": flatten(request.responseHeaders),
            "requestBodySize": request.requestBodySize,
            "responseBodySize": request.responseBodySize,
            "size": request.responseBodySize,
            "source": sourceWire,
            "runtime": "ios",
            "library": request.source.displayName,
            "redirectCount": request.redirectCount,
            "redirectChain": request.redirectUrls,
        ]

        if let status = request.status { payload["status"] = status }
        if let duration = request.duration { payload["duration"] = duration }
        if let body = request.requestBody { payload["requestBody"] = body }
        if let body = request.responseBody { payload["responseBody"] = body }
        if let error = request.error { payload["error"] = error }
        if let contentType = request.responseHeaders.first(where: { $0.key.lowercased() == "content-type" })?.value.first {
            payload["contentType"] = contentType
        }
        if let protocolName = request.networkProtocol {
            payload["networkProtocol"] = protocolName
        }
        if let operationName = request.graphqlOperationName {
            payload["graphqlOperationName"] = operationName
        }

        // WebSocket metadata
        if let count = request.wsMessageCount { payload["wsMessageCount"] = count }
        if let code = request.wsCloseCode { payload["wsCloseCode"] = code }

        var timing: [String: Any] = [:]
        if let value = request.dnsMs { timing["dnsMs"] = value }
        if let value = request.tlsMs { timing["tlsMs"] = value }
        if let value = request.connectMs { timing["connectMs"] = value }
        if let value = request.ttfbMs { timing["ttfbMs"] = value }
        if let value = request.downloadMs { timing["downloadMs"] = value }
        if !timing.isEmpty {
            payload["timing"] = timing
        }

        return payload
    }

    private static func dictionary(from summary: NetworkMetricsSummary) -> [String: Any] {
        var payload: [String: Any] = [
            "totalRequests": summary.totalRequests,
            "completedRequests": summary.completedRequests,
            "successCount": summary.successCount,
            "errorCount": summary.errorCount,
            "averageResponseTime": summary.averageResponseTime,
            "successRate": summary.successRate,
            "errorRate": summary.errorRate,
            "totalDataTransferred": summary.totalDataTransferred,
        ]
        if let p95LatencyMs = summary.p95LatencyMs {
            payload["p95LatencyMs"] = p95LatencyMs
        }
        return payload
    }

    private static func dictionary(from report: HealthReportRecord) -> [String: Any] {
        var payload: [String: Any] = [
            "id": report.id,
            "kind": report.kind.rawValue,
            "schemaVersion": report.schemaVersion,
            "timestamp": report.timestamp,
            "tags": report.tags,
            "windowStart": report.windowStart,
            "windowEnd": report.windowEnd,
            "totalRequests": report.totalRequests,
            "errorRate": report.errorRate,
        ]

        if let sessionId = report.sessionId { payload["sessionId"] = sessionId }
        if let slowFrameRate = report.slowFrameRate { payload["slowFrameRate"] = slowFrameRate }
        if let frozenFrameCount = report.frozenFrameCount { payload["frozenFrameCount"] = frozenFrameCount }
        if let summary = report.summary { payload["summary"] = summary }

        return payload
    }

    private static func mergedHealthReport(
        network: HealthReportRecord,
        performance: HealthReportRecord
    ) -> HealthReportRecord {
        var tags = network.tags
        for (key, value) in performance.tags {
            tags[key] = value
        }

        let summaries = [network.summary, performance.summary]
            .compactMap { $0 }
            .reduce(into: [String]()) { items, item in
                if !items.contains(item) { items.append(item) }
            }
        let summary = summaries.joined(separator: " | ")

        return HealthReportRecord(
            timestamp: network.timestamp,
            sessionId: network.sessionId,
            tags: tags,
            windowStart: min(network.windowStart, performance.windowStart),
            windowEnd: max(network.windowEnd, performance.windowEnd),
            totalRequests: network.totalRequests,
            errorRate: network.errorRate,
            slowFrameRate: performance.slowFrameRate ?? network.slowFrameRate,
            frozenFrameCount: performance.frozenFrameCount ?? network.frozenFrameCount,
            summary: summary.isEmpty ? nil : summary
        )
    }

    private static func flatten(_ headers: [String: [String]]) -> [String: String] {
        headers.reduce(into: [:]) { result, pair in
            result[pair.key] = pair.value.joined(separator: ", ")
        }
    }

    private static func stringMap(_ value: Any?) -> [String: String] {
        guard let dictionary = value as? [String: Any] else { return [:] }
        var result: [String: String] = [:]
        for (key, value) in dictionary {
            if let string = stringValue(value) {
                result[key] = string
            }
        }
        return result
    }

    /// Parses `headerValues` — the additive multi-value widening of
    /// `headers` (see `MockResponse.headerValues`'s doc in
    /// `ios/Sources/Common/MockRuleTypes.swift`). Mirrors `stringMap` above:
    /// fail-open, drops anything malformed rather than throwing, since the
    /// RN bridge (like `parseControlCommand`) must never crash the host app
    /// on a bad payload.
    private static func stringArrayMap(_ value: Any?) -> [String: [String]] {
        guard let dictionary = value as? [String: Any] else { return [:] }
        var result: [String: [String]] = [:]
        for (key, rawValues) in dictionary {
            guard let array = rawValues as? [Any] else { continue }
            let values = array.compactMap { stringValue($0) }
            guard !values.isEmpty else { continue }
            result[key] = values
        }
        return result
    }

    private static func stringValue(_ value: Any?) -> String? {
        switch value {
        case let string as String:
            return string
        case let number as NSNumber:
            return number.stringValue
        default:
            return nil
        }
    }

    private static func intValue(_ value: Any?) -> Int? {
        switch value {
        case let int as Int:
            return int
        case let number as NSNumber:
            return number.intValue
        case let string as String:
            return Int(string)
        default:
            return nil
        }
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        switch value {
        case let double as Double:
            return double
        case let number as NSNumber:
            return number.doubleValue
        case let string as String:
            return Double(string)
        default:
            return nil
        }
    }

    private static func boolValue(_ value: Any?) -> Bool? {
        switch value {
        case let bool as Bool:
            return bool
        case let number as NSNumber:
            return number.boolValue
        case let string as String:
            return Bool(string)
        default:
            return nil
        }
    }

    /// Parses the optional `modify` block from a JS-authored mock rule. A malformed
    /// sub-field drops the WHOLE `modify` block (returns `nil`) rather than just that
    /// field, so a rule never ends up with a half-applied edit set — the rest of the
    /// rule is still added, unlike `ControlCommand.swift`'s stricter sibling parser.
    private static func mockRuleModify(from value: Any?) -> MockRuleModify? {
        guard let obj = value as? [String: Any] else { return nil }

        func stringMap(_ key: String) -> [String: String]?? {
            guard let raw = obj[key], !(raw is NSNull) else { return .some(nil) }
            guard let dict = raw as? [String: Any] else { return nil }
            var out: [String: String] = [:]
            for (k, v) in dict {
                guard let s = v as? String else { return nil }
                out[k] = s
            }
            return .some(out)
        }

        func stringArray(_ key: String) -> [String]?? {
            guard let raw = obj[key], !(raw is NSNull) else { return .some(nil) }
            guard let arr = raw as? [Any] else { return nil }
            var out: [String] = []
            for item in arr {
                guard let s = item as? String else { return nil }
                out.append(s)
            }
            return .some(out)
        }

        guard let setRequestHeaders = stringMap("setRequestHeaders") else { return nil }
        guard let removeRequestHeaders = stringArray("removeRequestHeaders") else { return nil }
        guard let setQueryParams = stringMap("setQueryParams") else { return nil }
        guard let removeQueryParams = stringArray("removeQueryParams") else { return nil }
        guard let setResponseHeaders = stringMap("setResponseHeaders") else { return nil }
        guard let removeResponseHeaders = stringArray("removeResponseHeaders") else { return nil }

        var status: Int?
        if let rawStatus = obj["status"], !(rawStatus is NSNull) {
            guard let n = rawStatus as? NSNumber else { return nil }
            status = n.intValue
        }

        var replaceBody: [MockRuleModify.BodyReplacement]?
        if let rawReplace = obj["replaceBody"], !(rawReplace is NSNull) {
            guard let arr = rawReplace as? [Any] else { return nil }
            var out: [MockRuleModify.BodyReplacement] = []
            for item in arr {
                guard let entry = item as? [String: Any],
                      let find = entry["find"] as? String,
                      let replace = entry["replace"] as? String
                else { return nil }
                out.append(MockRuleModify.BodyReplacement(find: find, replace: replace))
            }
            replaceBody = out
        }

        return MockRuleModify(
            setRequestHeaders: setRequestHeaders,
            removeRequestHeaders: removeRequestHeaders,
            setQueryParams: setQueryParams,
            removeQueryParams: removeQueryParams,
            status: status,
            setResponseHeaders: setResponseHeaders,
            removeResponseHeaders: removeResponseHeaders,
            replaceBody: replaceBody
        )
    }

    /// Parses the optional `failure` block from a JS-authored mock rule
    /// (`NativeMockRulePayload.failure` in `MockEngine.ts`). Unknown/missing
    /// `code` drops the whole block — a rule never ends up "failure-shaped"
    /// with no actual code to throw.
    private static func mockFailure(from value: Any?) -> MockFailure? {
        guard let obj = value as? [String: Any],
              let codeString = obj["code"] as? String,
              let code = MockFailureCode(rawValue: codeString)
        else { return nil }
        return MockFailure(code: code)
    }

    /// A non-negative integer count (`skipCount`/`stopAfter`) — mirrors
    /// `parseNonNegativeInt` in `ControlCommandParsingMock.swift`. Booleans
    /// (`NSNumber` also wraps `Bool`) and non-integral values are rejected.
    private static func nonNegativeIntValue(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber else { return nil }
        if CFGetTypeID(number) == CFBooleanGetTypeID() { return nil }
        let d = number.doubleValue
        guard d.isFinite, d == d.rounded(), d >= 0 else { return nil }
        return number.intValue
    }
}

private final class RNHakkaPerformanceMonitor: @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [FrameMetricRecord] = []
    private var memory: MemoryMetricRecord?
    private var cpu: CpuMetricRecord?
    private var performance: HakkaPerformance?
    private var subscription: SinkSubscription?
    private var idleStop: DispatchWorkItem?

    func healthReport() -> HealthReportRecord {
        let perf = ensureStarted()
        let collectorReport = perf.healthReport()
        let snapshot = withLock { (frames, memory, cpu) }

        return HealthReportGenerator.generate(
            from: snapshot.0.map { $0 as any ContractRecord },
            options: HealthReportBuildOptions(
                timestamp: collectorReport.timestamp,
                sessionId: collectorReport.sessionId,
                tags: collectorReport.tags.merging(
                    Self.tags(
                        frames: snapshot.0,
                        memory: snapshot.1,
                        cpu: snapshot.2,
                        droppedRecords: perf.droppedSinkRecords()
                    )
                ) { _, new in new }
            )
        )
    }

    private func ensureStarted() -> HakkaPerformance {
        lock.lock()
        defer { lock.unlock() }

        if let performance {
            if !performance.isRunning { performance.start() }
            scheduleIdleStopLocked()
            return performance
        }

        let next = HakkaPerformance { builder in
            builder.sampleIntervalMs = 1000
            builder.tags = ["surface": "react-native-monitor"]
            builder.enableFrameMetrics = true
            builder.enableMemoryMetrics = true
            builder.enableCpuMetrics = true
            builder.enableNetworkUsageMetrics = false
        }
        subscription = next.addSink { [weak self] record in
            if let frame = record as? FrameMetricRecord {
                self?.record(frame)
            } else if let memory = record as? MemoryMetricRecord {
                self?.record(memory)
            } else if let cpu = record as? CpuMetricRecord {
                self?.record(cpu)
            }
        }
        performance = next
        next.start()
        scheduleIdleStopLocked()
        return next
    }

    private func scheduleIdleStopLocked() {
        idleStop?.cancel()
        let workItem = DispatchWorkItem { [weak self] in self?.stopForIdle() }
        idleStop = workItem
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 10, execute: workItem)
    }

    private func stopForIdle() {
        let toClose: HakkaPerformance? = withLock {
            idleStop = nil
            frames.removeAll(keepingCapacity: true)
            memory = nil
            cpu = nil
            subscription?.cancel()
            subscription = nil
            let current = performance
            performance = nil
            return current
        }
        toClose?.close()
    }

    private func record(_ frame: FrameMetricRecord) {
        withLock {
            if frames.count >= 90 {
                frames.removeFirst(frames.count - 89)
            }
            frames.append(frame)
        }
    }

    private func record(_ sample: MemoryMetricRecord) {
        withLock {
            memory = sample
        }
    }

    private func record(_ sample: CpuMetricRecord) {
        withLock {
            cpu = sample
        }
    }

    private static func tags(
        frames: [FrameMetricRecord],
        memory: MemoryMetricRecord?,
        cpu: CpuMetricRecord?,
        droppedRecords: Int
    ) -> [String: String] {
        var tags: [String: String] = [:]
        if let frame = frames.last {
            if let fps = frame.tags["fps"] {
                tags["fps"] = fps
                tags["frame.fps"] = fps
            }
            if let refreshRateHz = frame.refreshRateHz {
                tags["frame.refreshRateHz"] = String(refreshRateHz)
            }
            if let p95 = frame.tags["frameDurationP95Ms"] {
                tags["frame.durationP95Ms"] = p95
            }
            if let p99 = frame.tags["frameDurationP99Ms"] {
                tags["frame.durationP99Ms"] = p99
            }
            if let jankRate = frame.tags["jankFrameRate"] {
                tags["frame.jankRate"] = jankRate
            }
            if let frozenRate = frame.tags["frozenFrameRate"] {
                tags["frame.frozenRate"] = frozenRate
            }
        }
        if let memory {
            if let pssBytes = memory.pssBytes {
                tags["memory.pssBytes"] = String(pssBytes)
                tags["memory.ramBytes"] = String(pssBytes)
            }
            if let heapUsedBytes = memory.heapUsedBytes {
                tags["memory.heapUsedBytes"] = String(heapUsedBytes)
            }
            if let heapMaxBytes = memory.heapMaxBytes {
                tags["memory.heapMaxBytes"] = String(heapMaxBytes)
            }
            if let physicalFootprintBytes = memory.tags["physicalFootprintBytes"] {
                tags["memory.nativeHeapBytes"] = physicalFootprintBytes
            }
            if let residentBytes = memory.tags["residentBytes"] {
                tags["memory.residentBytes"] = residentBytes
            }
            copyTags(from: memory.tags, to: &tags, keys: runtimeTagKeys)
        }
        if let cpu {
            if let processCpuPercent = cpu.processCpuPercent {
                tags["cpu.processPercent"] = String(processCpuPercent)
            }
            copyTags(from: cpu.tags, to: &tags, keys: runtimeTagKeys)
        }
        tags["monitor.droppedRecords"] = String(droppedRecords)
        return tags
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}

private let runtimeTagKeys = [
    "thermal.state",
    "memory.warningCount",
    "memory.lastWarningTimestamp",
]

private func copyTags(from source: [String: String], to target: inout [String: String], keys: [String]) {
    for key in keys {
        if let value = source[key] {
            target[key] = value
        }
    }
}
