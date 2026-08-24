package com.noodleapps.hakka

import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.ResponseBody.Companion.asResponseBody
import okhttp3.MediaType.Companion.toMediaType
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Source
import okio.buffer
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

/**
 * Maps a [MockFailureCode] to the [IOException] subtype OkHttp callers actually see —
 * mirrors `MockFailureCode`'s cross-runtime mapping table in
 * `packages/hakka-core/src/engine/MockEngine.ts`.
 */
private fun ioExceptionForFailure(code: MockFailureCode): IOException = when (code) {
    MockFailureCode.TIMEOUT -> java.net.SocketTimeoutException(code.message)
    // Android has no distinct "no connectivity" exception from a DNS failure —
    // UnknownHostException is the closest native shape for both NO_CONNECTION and
    // CANNOT_FIND_HOST, distinguished only by the mock's declared code (message text).
    MockFailureCode.NO_CONNECTION -> java.net.UnknownHostException(code.message)
    MockFailureCode.CANNOT_FIND_HOST -> java.net.UnknownHostException(code.message)
    MockFailureCode.CANNOT_CONNECT_TO_HOST -> java.net.ConnectException(code.message)
    MockFailureCode.CONNECTION_LOST -> IOException(code.message)
    MockFailureCode.SECURE_CONNECTION_FAILED -> javax.net.ssl.SSLException(code.message)
    MockFailureCode.CANCELLED -> IOException(code.message)
    MockFailureCode.UNKNOWN -> IOException(code.message)
}

/**
 * OkHttp [Interceptor] that captures network requests and stores them in a [LogStore].
 *
 * Usage:
 * ```kotlin
 * val interceptor = HakkaInterceptor {
 *     maxRequests = 1000
 *     redactHeaders = setOf("authorization", "x-api-key")
 * }
 * val client = OkHttpClient.Builder()
 *     .addInterceptor(interceptor)
 *     .eventListenerFactory(interceptor.eventListenerFactory()!!)
 *     .build()
 * ```
 */
class HakkaInterceptor private constructor(
    initialConfig: HakkaConfig,
    private val listeners: List<HakkaListener>,
    initialSinks: List<RecordSink>,
    private val eventListenerFactory: HakkaEventListener.Factory?,
) : Interceptor, AutoCloseable {

    /**
     * Current configuration snapshot. Read-only from outside the class — mutate only via
     * [updateConfig], which keeps [logStore]'s retention policy in sync. Mirrors
     * `HakkaInterceptor.shared.config` on iOS; the Settings UI reads this to seed its
     * controls with live values before writing changes back through [updateConfig].
     */
    @Volatile var config: HakkaConfig = initialConfig
        private set

    /** The log store containing completed requests. */
    val logStore = LogStore(initialConfig)

    private val recordSinks = RecordSinkHub(initialConfig.maxRequests).also { hub ->
        initialSinks.forEach { hub.add(it) }
    }

    /** Plugin request listeners — notified after each request lands in the [logStore]. */
    private val pluginListeners = CopyOnWriteArrayList<(NetworkRequest) -> Unit>()

    private val captureProcessor = CaptureProcessor(
        configProvider = { config },
        logStore = logStore,
        listeners = listeners,
        onRecord = recordSinks::emit,
        onProcessed = { id -> inFlight.remove(id) },
        pluginListeners = pluginListeners,
    )

    /**
     * Plugin registry for this interceptor instance.
     * Use [plugins].use(plugin) to register plugins programmatically.
     * Mirrors `Hakka.use(plugin)` from the TypeScript core.
     */
    val plugins: PluginRegistry = PluginRegistry {
        HakkaPluginContextImpl(
            logStore = logStore,
            sinkHub = recordSinks,
            onIngest = { req ->
                logStore.add(req)
                listeners.forEach { it.onRequest(req) }
                pluginListeners.forEach { it(req) }
            },
            requestListeners = pluginListeners,
        )
    }

    /**
     * Pauses request capture. Requests received while paused are buffered and will be
     * flushed into the log when [resume] is called. In-flight requests are unaffected.
     * Idempotent and thread-safe.
     */
    fun pause() = logStore.pause()

    /**
     * Resumes request capture after [pause]. Buffered requests are flushed into the log
     * in arrival order, then normal capture continues. Idempotent and thread-safe.
     */
    fun resume() = logStore.resume()

    /** Returns true while capture is paused; requests are buffered, not stored. */
    val isPaused: Boolean get() = logStore.isPaused

    /**
     * Atomically updates the interceptor configuration.
     * Propagates the new retention policy to [logStore] immediately.
     * Mirrors `updateConfig(_:)` on iOS.
     */
    fun updateConfig(transform: (HakkaConfig) -> HakkaConfig) {
        val newConfig = transform(config)
        config = newConfig
        logStore.updateRetentionPolicy(RetentionPolicy.from(newConfig))
    }

    /**
     * The active retention policy derived from the current config.
     * Mirrors [retentionPolicy] on iOS.
     */
    val retentionPolicy: RetentionPolicy get() = RetentionPolicy.from(config)

    private val inFlight = ConcurrentHashMap<String, NetworkRequest>()

    /** Returns a snapshot of requests currently in-flight. */
    fun inFlightRequests(): List<NetworkRequest> = inFlight.values.toList()

    /** Returns the last [count] captured requests, newest first. Use for crash-attach. */
    fun recentRequests(count: Int = 20): List<NetworkRequest> = logStore.recent(count)

    /** Flushes queued capture processing. Intended for deterministic tests and tooling. */
    fun flushCaptureProcessing(timeoutMs: Long = 5_000L): Boolean =
        captureProcessor.flush(timeoutMs)

    /** Flushes queued sink delivery. Intended for deterministic tests and tooling. */
    fun flushSinks(timeoutMs: Long = 5_000L): Boolean =
        recordSinks.flush(timeoutMs)

    /** Number of records dropped because sink delivery was saturated or shut down. */
    fun droppedSinkRecords(): Long = recordSinks.droppedCount()

    /** Builds a native health report from the current bounded store snapshot. */
    fun healthReport(
        timestampMs: Long = System.currentTimeMillis(),
        sessionId: String? = null,
        tags: Map<String, String> = emptyMap(),
    ): HealthReportRecord {
        val requests = logStore.all()
        val inFlightCount = inFlight.size
        val droppedSinkRecords = droppedSinkRecords()
        val redactionFieldCount = config.redactHeaders.size +
            config.sensitiveQueryItems.size +
            config.sensitiveBodyFields.size
        val healthTags = tags + mapOf(
            "component.capture.inFlightCount" to inFlightCount.toString(),
            "component.storage.count" to requests.size.toString(),
            "component.storage.maxCount" to config.maxRequests.toString(),
            "component.redaction.headerCount" to config.redactHeaders.size.toString(),
            "component.redaction.queryItemCount" to config.sensitiveQueryItems.size.toString(),
            "component.redaction.bodyFieldCount" to config.sensitiveBodyFields.size.toString(),
        )

        return HealthReportGenerator.fromRecords(
            records = requests.map { NetworkRecord.from(it, id = it.id, timestampMs = it.startTimeMs) },
            options = HealthReportBuildOptions(
                timestampMs = timestampMs,
                sessionId = sessionId,
                tags = healthTags,
                componentHealth = mapOf(
                    "capture" to ComponentHealth(status = if (inFlightCount > 0) "active" else "idle"),
                    "storage" to ComponentHealth(status = "ok"),
                    "redaction" to ComponentHealth(
                        status = if (redactionFieldCount > 0) "configured" else "disabled",
                    ),
                    "sink" to ComponentHealth(
                        status = if (droppedSinkRecords > 0) "dropping" else "ok",
                        droppedCount = droppedSinkRecords,
                    ),
                ),
            ),
        )
    }

    /**
     * Returns aggregate metrics over the current in-memory buffer.
     * Convenience wrapper over [LogStore.metricsSummary].
     * Mirrors [HakkaInterceptor.networkMetricsSummary] on iOS.
     */
    fun networkMetricsSummary(): NetworkMetricsSummary = logStore.metricsSummary()

    /** Stops the capture processor after queued work drains or the timeout elapses. */
    fun shutdownCaptureProcessing(timeoutMs: Long = 1_000L): Boolean =
        captureProcessor.close(timeoutMs)

    /** Stops sink delivery after queued work drains or the timeout elapses. */
    fun shutdownSinks(timeoutMs: Long = 1_000L): Boolean =
        recordSinks.shutdown(timeoutMs)

    override fun close() {
        plugins.removeAll()
        shutdownCaptureProcessing()
        shutdownSinks()
        // shutdownSinks() only stops RecordSinkHub's delivery executor — it never calls
        // close() on the sinks it holds. Every BridgeSink owns a live OkHttp WebSocket plus
        // its own reconnect scheduler thread, so it must be closed explicitly or both leak
        // and the sink keeps retrying to reconnect indefinitely.
        bridgeSinks.forEach { it.close() }
        bridgeSinks.clear()
    }

    /** Builder DSL for configuring the interceptor. */
    class Builder {
        /** Max requests in ring buffer. */
        var maxRequests: Int = 500
        /** Max body size to capture in bytes. */
        var maxBodySize: Long = 262_144L
        /** Headers to redact (case-insensitive). */
        var redactHeaders: Set<String> = HakkaConfig.DEFAULT_REDACTED_HEADERS
        /** Hosts to skip (exact match). */
        var ignoreHosts: Set<String> = emptySet()
        /** URL regex patterns to ignore. Matched against the full URL string. */
        var ignorePatterns: List<String> = emptyList()
        /** URL query parameter names to redact (case-insensitive). Values replaced with "██". */
        var sensitiveQueryItems: Set<String> = emptySet()
        /** JSON body field names to redact recursively (case-insensitive). Values replaced with "██". */
        var sensitiveBodyFields: Set<String> = emptySet()
        /** Max age of stored requests in ms. */
        var maxAgeMs: Long? = null
        /** Enable native timing capture via EventListener. Default: true. */
        var enableTiming: Boolean = true
        /**
         * WebSocket URL of the Hakka desktop bridge hub (e.g. `ws://localhost:8989`).
         * When non-null, a [BridgeSink] is automatically added so every captured request
         * is streamed to the bridge and becomes visible in hakka mcp and the desktop app.
         * Default: null (disabled).
         */
        var bridgeUrl: String? = null
        /**
         * When true, injects `x-hakka-trace: <uuid>` on each outgoing request and
         * stamps the same value as `correlationId` on the captured record.
         * Off by default — the header is never sent without explicit opt-in.
         * See [HakkaConfig.traceEnabled] for full semantics.
         */
        var traceEnabled: Boolean = false
        /**
         * Additional hosts that may receive the `x-hakka-trace` header when
         * [traceEnabled] is true. When empty, all captured hosts are eligible.
         * See [HakkaConfig.tracePropagateOrigins] for full semantics.
         */
        var tracePropagateOrigins: List<String> = emptyList()

        private val listeners = mutableListOf<HakkaListener>()
        private val sinks = mutableListOf<RecordSink>()

        /** Adds a listener for captured requests. */
        fun listener(listener: HakkaListener): Builder = apply { listeners.add(listener) }

        /** Adds a sink for processed records. */
        fun sink(sink: RecordSink): Builder = apply { sinks.add(sink) }

        /** Builds the interceptor. */
        fun build(): HakkaInterceptor {
            val config = HakkaConfig(
                maxRequests, maxBodySize, redactHeaders,
                sensitiveQueryItems, sensitiveBodyFields,
                ignoreHosts, ignorePatterns, maxAgeMs,
                bridgeUrl, traceEnabled, tracePropagateOrigins,
            )
            val allSinks = sinks.toMutableList()
            val bridgeSink = bridgeUrl?.let { url -> BridgeSink(url) }
            bridgeSink?.let { allSinks.add(it) }
            val factory = if (enableTiming) HakkaEventListener.Factory() else null
            val interceptor = HakkaInterceptor(config, listeners.toList(), allSinks, factory)
            bridgeSink?.let { interceptor.registerBridgeSink(it) }
            return interceptor
        }
    }

    /**
     * Every [BridgeSink] currently attached to this interceptor — the one created from
     * [Builder.bridgeUrl] (if any) plus any attached later via [connectBridge]. [sendConsoleFrame]
     * and [sendStorageFrame] forward to all of them, since more than one can be active at once
     * (a fixed [Builder.bridgeUrl] alongside a discovery-attached hub).
     */
    private val bridgeSinks = CopyOnWriteArrayList<BridgeSink>()

    /** Registers a [BridgeSink] to receive [sendConsoleFrame]/[sendStorageFrame] calls. Internal — used by [Builder.build] and [connectBridge]. */
    internal fun registerBridgeSink(sink: BridgeSink) {
        bridgeSinks.add(sink)
    }

    /** Unregisters a [BridgeSink] previously added via [registerBridgeSink]. Internal — used by [connectBridge]'s teardown. */
    internal fun unregisterBridgeSink(sink: BridgeSink) {
        bridgeSinks.remove(sink)
    }

    /**
     * Streams one or more structured log entries to every attached bridge hub as a
     * `{"type":"console","payload":[...]}` frame. Mirrors iOS's `HakkaInterceptor.log(...)` →
     * `HakkaBridgeClient.sendConsole`. No-op when no bridge is attached.
     */
    fun sendConsoleFrame(entries: List<LogEntry>) {
        bridgeSinks.forEach { it.sendConsole(entries) }
    }

    /**
     * Streams a named storage snapshot to every attached bridge hub as a
     * `{"type":"storage","payload":{...}}` frame. Mirrors iOS's
     * `HakkaInterceptor.publishStorageSnapshot(store:entries:)` →
     * `HakkaBridgeClient.sendStorage`. No-op when no bridge is attached.
     */
    fun sendStorageFrame(snapshot: StorageSnapshot) {
        bridgeSinks.forEach { it.sendStorage(snapshot) }
    }

    /** Adds a sink at runtime. Close the returned subscription to stop delivery. */
    fun addSink(sink: RecordSink): SinkSubscription = recordSinks.add(sink)

    /**
     * Emits an externally-produced record (breadcrumb, trace, …) into the sink
     * fan-out, alongside captured network records. Bridges use this to export
     * observability events through the same path as captured requests.
     */
    fun injectRecord(record: ContractRecord) = recordSinks.emit(record)

    /**
     * Returns the [HakkaEventListener.Factory] to install on your OkHttpClient.
     * Must be added via `OkHttpClient.Builder.eventListenerFactory()` to capture timing.
     * Returns null if timing capture was not enabled.
     */
    fun eventListenerFactory(): HakkaEventListener.Factory? = eventListenerFactory

    @Throws(IOException::class)
    override fun intercept(chain: Interceptor.Chain): Response {
        var request = chain.request()

        // Per-request opt-out: `x-hakka-ignore` header or a Boolean tag(true) skips capture
        // without reconfiguring the interceptor (health-checks, analytics pings, etc.).
        val ignoreHeader = request.header("x-hakka-ignore")
        val ignoreTag = request.tag(java.lang.Boolean::class.java) == true
        if (ignoreHeader != null || ignoreTag) {
            // Strip the header before forwarding — do not leak it to the server
            request = request.newBuilder().removeHeader("x-hakka-ignore").build()
            return chain.proceed(request)
        }

        val urlString = request.url.toString()
        if (config.shouldIgnoreHost(request.url.host)) return chain.proceed(request)
        if (config.shouldIgnoreUrl(urlString)) return chain.proceed(request)

        val id = UUID.randomUUID().toString()
        val startTime = System.currentTimeMillis()

        // UUID is generated fresh per request so each hop can be correlated independently.
        val correlationId: String?
        if (config.shouldPropagateTrace(request.url.host)) {
            correlationId = UUID.randomUUID().toString()
            request = request.newBuilder()
                .header("x-hakka-trace", correlationId)
                .build()
        } else {
            correlationId = null
        }

        // Register as in-flight so callers can show a pending state.
        // Strip query string to avoid exposing unredacted sensitiveQueryItems.
        val inFlightUrl = request.url.newBuilder().query(null).build().toString()
        inFlight[id] = NetworkRequest(
            id = id, url = inFlightUrl, method = HttpMethod.from(request.method),
            status = null, startTimeMs = startTime, durationMs = null,
            requestHeaders = emptyMap(), responseHeaders = emptyMap(),
            requestBodySize = 0, responseBodySize = 0,
            requestBody = null, responseBody = null,
            error = null, source = RequestSource.OKHTTP,
        )

        // Tracks whether a capture record was handed to captureProcessor for this id.
        // CaptureProcessor's onProcessed callback is the only other place inFlight[id] is
        // removed, so any exit below that never reaches an enqueue call (breakpoint abort,
        // a non-IOException thrown out of chain.proceed) must clean up in the finally block
        // or the entry leaks in inFlight forever.
        var captureEnqueued = false
        try {
            // Capture request body — measure size from Buffer (accurate for chunked too)
            val reqContentType = request.body?.contentType()?.toString()
            var reqBodySize = 0L
            val reqBodyText: String?
            val requestBodyBuffer = request.body?.let { body ->
                if (body.isDuplex() || body.isOneShot()) null
                else {
                    val buf = Buffer()
                    body.writeTo(buf)
                    reqBodySize = buf.size
                    buf
                }
            }
            reqBodyText = if (isTextContentType(reqContentType)) captureBody(requestBodyBuffer) else null

            val bpEngine = BreakpointEngine.shared
            if (bpEngine.matches(urlString, request.method, BreakpointPhase.REQUEST)) {
                val reqSnapshot = PausedRequest(
                    url = urlString,
                    method = request.method,
                    headers = request.headers.toSingleValueMap(),
                    body = reqBodyText,
                )
                val action = try {
                    bpEngine.pauseRequest(id, reqSnapshot)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    ResumeRequestAction.Abort
                }
                when (action) {
                    is ResumeRequestAction.Abort -> throw AbortedException()
                    is ResumeRequestAction.Resume -> {
                        val edits = action.edits
                        if (edits != null) {
                            val builder = request.newBuilder()
                            val editedUrl = edits.url
                            val editedMethod = edits.method
                            val editedHeaders = edits.headers
                            if (editedUrl != null) builder.url(editedUrl)
                            if (editedMethod != null) builder.method(editedMethod, request.body)
                            if (editedHeaders != null) {
                                val newHeaders = Headers.Builder()
                                for ((k, v) in editedHeaders) newHeaders.add(k, v)
                                builder.headers(newHeaders.build())
                            }
                            request = builder.build()
                        }
                    }
                }
            }

            val mockRule = MockEngine.shared.match(urlString, request.method)

            // `failure` takes priority over `block`, which takes priority over
            // `redirectTo`/`modify` (mirrors MockEngine.ts's fetch-interceptor
            // ordering: failure, then block, then isRewrite). A more precise
            // simulation than block's generic "Blocked by Hakka" — throws the
            // specific IOException subtype the failure code declares.
            if (mockRule != null && mockRule.failure != null) {
                val failure = mockRule.failure
                val failureDuration = System.currentTimeMillis() - startTime
                captureProcessor.enqueue(
                    RawNetworkCapture(
                        id = id,
                        url = urlString,
                        method = request.method,
                        startTimeMs = startTime,
                        durationMs = failureDuration,
                        requestHeaders = request.headers.toMultimap(),
                        responseHeaders = emptyMap(),
                        requestBodySize = reqBodySize,
                        responseBodySize = 0,
                        requestContentType = reqContentType,
                        responseContentType = null,
                        requestBody = reqBodyText,
                        responseBody = null,
                        status = null,
                        error = failure.code.message,
                        source = RequestSource.OKHTTP,
                        timing = null,
                        correlationId = correlationId,
                    )
                )
                captureEnqueued = true
                throw ioExceptionForFailure(failure.code)
            }

            // `block` takes priority over `redirectTo`/`modify` (mirrors MockEngine.ts's
            // fetch-interceptor ordering: block is checked before isRewrite). Abort with an
            // IOException before the real request is ever sent — recorded as a completed
            // capture with an error, consistent with the offline-throttle error record below.
            if (mockRule != null && mockRule.block) {
                val blockDuration = System.currentTimeMillis() - startTime
                captureProcessor.enqueue(
                    RawNetworkCapture(
                        id = id,
                        url = urlString,
                        method = request.method,
                        startTimeMs = startTime,
                        durationMs = blockDuration,
                        requestHeaders = request.headers.toMultimap(),
                        responseHeaders = emptyMap(),
                        requestBodySize = reqBodySize,
                        responseBodySize = 0,
                        requestContentType = reqContentType,
                        responseContentType = null,
                        requestBody = reqBodyText,
                        responseBody = null,
                        status = null,
                        error = "Blocked by Hakka",
                        source = RequestSource.OKHTTP,
                        timing = null,
                        correlationId = correlationId,
                    )
                )
                captureEnqueued = true
                throw IOException("Blocked by Hakka")
            }

            if (mockRule != null && mockRule.isRewrite) {
                val rewriteResponse = interceptRewrite(
                    chain = chain,
                    rule = mockRule,
                    request = request,
                    id = id,
                    startTime = startTime,
                    reqContentType = reqContentType,
                    reqBodySize = reqBodySize,
                    reqBodyText = reqBodyText,
                    correlationId = correlationId,
                )
                // interceptRewrite() only returns (rather than throws) after it has already
                // enqueued its own capture record.
                captureEnqueued = true
                return rewriteResponse
            }

            if (mockRule != null) {
                val mockResp = mockRule.response
                if (mockResp.delayMs > 0) Thread.sleep(mockResp.delayMs)

                val mockBody = mockResp.body
                val mockBodySize = mockBody?.toByteArray(Charsets.UTF_8)?.size?.toLong() ?: 0L
                val mockDuration = System.currentTimeMillis() - startTime
                val mockHeaders = mockResp.headers.mapValues { (k, v) -> mockResp.headerValues[k] ?: listOf(v) }
                captureProcessor.enqueue(
                    RawNetworkCapture(
                        id = id,
                        url = urlString,
                        method = request.method,
                        startTimeMs = startTime,
                        durationMs = mockDuration,
                        requestHeaders = request.headers.toMultimap(),
                        responseHeaders = mockHeaders,
                        requestBodySize = reqBodySize,
                        responseBodySize = mockBodySize,
                        requestContentType = reqContentType,
                        responseContentType = "application/json",
                        requestBody = reqBodyText,
                        responseBody = mockBody,
                        status = mockResp.status,
                        error = null,
                        source = RequestSource.OKHTTP,
                        timing = null,
                        correlationId = correlationId,
                    )
                )
                captureEnqueued = true

                // `headerValues` widens single-value `headers` for names with more than one
                // value (chiefly Set-Cookie — see [MockResponse.headerValues]'s doc). OkHttp's
                // `Headers` natively supports repeated names, so this is a true multi-header
                // apply, not a join: names covered by `headerValues` are skipped from `headers`
                // (which only carries their representative first value) and every one of their
                // real values is included instead.
                val okhttpHeaderPairs = mockResp.headers
                    .filterKeys { it !in mockResp.headerValues }
                    .flatMap { listOf(it.key, it.value) } +
                    mockResp.headerValues.flatMap { (name, values) -> values.flatMap { listOf(name, it) } }
                val okhttpHeaders = Headers.headersOf(*okhttpHeaderPairs.toTypedArray())
                return Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(mockResp.status)
                    .message(HTTP_STATUS_REASONS[mockResp.status] ?: "Mock")
                    .headers(okhttpHeaders)
                    .body(mockBody?.toResponseBody("application/json".toMediaType()))
                    .build()
            }

            var response: Response? = null
            var error: String? = null
            // Preserves the original exception's type/stacktrace (SocketTimeoutException,
            // SSLException, UnknownHostException, …) so host code that switches on the
            // subtype for retry/backoff logic keeps working once this interceptor is
            // installed — only `error`'s message string is used for the capture record.
            var networkException: IOException? = null

            val throttle = ThrottleEngine.shared
            if (throttle.isActive) {
                if (throttle.isOffline) {
                    val offlineDuration = System.currentTimeMillis() - startTime
                    captureProcessor.enqueue(
                        RawNetworkCapture(
                            id = id,
                            url = urlString,
                            method = request.method,
                            startTimeMs = startTime,
                            durationMs = offlineDuration,
                            requestHeaders = request.headers.toMultimap(),
                            responseHeaders = emptyMap(),
                            requestBodySize = reqBodySize,
                            responseBodySize = 0,
                            requestContentType = reqContentType,
                            responseContentType = null,
                            requestBody = reqBodyText,
                            responseBody = null,
                            status = null,
                            error = "Network request failed — offline (Hakka ThrottleEngine)",
                            source = RequestSource.OKHTTP,
                            timing = null,
                            correlationId = correlationId,
                        )
                    )
                    captureEnqueued = true
                    throw IOException("Network request failed — offline (Hakka ThrottleEngine)")
                }
                val latencyMs = throttle.config.latencyMs
                if (latencyMs > 0L) Thread.sleep(latencyMs)
            }

            try {
                response = chain.proceed(request)
            } catch (e: AbortedException) {
                throw e // propagate abort directly — do not record as a network error
            } catch (e: IOException) {
                error = e.message ?: "Network error"
                networkException = e
            }

            if (response != null && throttle.isActive && throttle.config.downloadKbps > 0L) {
                val body = response.body
                if (body != null) {
                    val throttledSource = ThrottledSource(body.source(), throttle)
                    response = response.newBuilder()
                        .body(throttledSource.buffer().asResponseBody(body.contentType(), body.contentLength()))
                        .build()
                }
            }

            val duration = System.currentTimeMillis() - startTime

            // Capture response body (size-limited, text types only, without consuming)
            var respBodyText: String? = null
            var respBodySize = 0L
            var respContentType: String? = null
            response?.let { resp ->
                resp.body?.let { body ->
                    val source = body.source()
                    peekResponseBody(source, config.maxBodySize)
                    val buffer = source.buffer
                    respBodySize = buffer.size
                    respContentType = resp.body?.contentType()?.toString()
                    if (isTextContentType(respContentType)) {
                        respBodyText = captureBody(buffer.clone())
                    }
                }
            }

            if (response != null && bpEngine.matches(urlString, request.method, BreakpointPhase.RESPONSE)) {
                val respSnapshot = PausedResponse(
                    status = response.code,
                    headers = response.headers.toSingleValueMap(),
                    body = respBodyText ?: "",
                )
                val action = try {
                    bpEngine.pauseResponse(id, respSnapshot)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    ResumeResponseAction.Abort
                }
                when (action) {
                    is ResumeResponseAction.Abort -> {
                        response.close()
                        throw AbortedException()
                    }
                    is ResumeResponseAction.Resume -> {
                        val edits = action.edits
                        if (edits != null) {
                            val newStatus = edits.status ?: response.code
                            val newHeaders = if (edits.headers != null) {
                                val hb = Headers.Builder()
                                for ((k, v) in edits.headers) hb.add(k, v)
                                hb.build()
                            } else {
                                response.headers
                            }
                            val builder = response.newBuilder()
                                .code(newStatus)
                                .headers(newHeaders)
                            // `edits.body == null` means "keep the original value" (see
                            // PausedResponseEdits's doc) — only rebuild the body when the
                            // caller actually supplied a replacement, otherwise leave the
                            // real (possibly binary or truncated-preview-only) body intact.
                            val editedBody = edits.body
                            if (editedBody != null) {
                                val ct = (edits.headers?.get("content-type")
                                    ?: edits.headers?.get("Content-Type")
                                    ?: respContentType
                                    ?: "application/octet-stream").toMediaType()
                                builder.body(editedBody.toResponseBody(ct))
                                respBodyText = editedBody
                                respBodySize = editedBody.toByteArray(Charsets.UTF_8).size.toLong()
                                respContentType = ct.toString()
                            }
                            response = builder.build()
                        }
                    }
                }
            }

            val timing = eventListenerFactory?.consume(chain.call())

            captureProcessor.enqueue(
                RawNetworkCapture(
                    id = id,
                    url = urlString,
                    method = request.method,
                    startTimeMs = startTime,
                    durationMs = duration,
                    requestHeaders = request.headers.toMultimap(),
                    responseHeaders = response?.headers?.toMultimap() ?: emptyMap(),
                    requestBodySize = reqBodySize,
                    responseBodySize = respBodySize,
                    requestContentType = reqContentType,
                    responseContentType = respContentType,
                    requestBody = reqBodyText,
                    responseBody = respBodyText,
                    status = response?.code,
                    error = error,
                    source = RequestSource.OKHTTP,
                    timing = timing,
                    correlationId = correlationId,
                )
            )
            captureEnqueued = true

            return response ?: throw (networkException ?: IOException(error ?: "Unknown error"))
        } finally {
            if (!captureEnqueued) inFlight.remove(id)
        }
    }

    /**
     * Handles a matched rewrite-mode rule (`redirectTo` and/or `modify`): rewrites the URL
     * first, then applies `modify`'s query/header edits on top (matches `MockEngine.ts`'s
     * `applyRewriteRequest` order), issues the real request via [chain], then applies the
     * response-side edits before returning. Captured as a normal request (`source = OKHTTP`)
     * since a real network round-trip happened.
     */
    @Throws(IOException::class)
    private fun interceptRewrite(
        chain: Interceptor.Chain,
        rule: MockRule,
        request: Request,
        id: String,
        startTime: Long,
        reqContentType: String?,
        reqBodySize: Long,
        reqBodyText: String?,
        correlationId: String?,
    ): Response {
        val modify = rule.modify
        var rewrittenRequest = request

        var urlString = rewrittenRequest.url.toString()
        if (!rule.redirectTo.isNullOrEmpty()) {
            urlString = rule.redirectTo
        }
        if (modify != null) {
            urlString = MockRuleTransform.applyQueryEdits(urlString, modify.setQueryParams, modify.removeQueryParams)
        }
        if (urlString != rewrittenRequest.url.toString()) {
            urlString.toHttpUrlOrNull()?.let { newUrl ->
                rewrittenRequest = rewrittenRequest.newBuilder().url(newUrl).build()
            }
        }

        if (modify != null && (modify.setRequestHeaders != null || modify.removeRequestHeaders != null)) {
            val newHeaders = MockRuleTransform.applyHeaderEdits(
                headers = rewrittenRequest.headers.toSingleValueMap(),
                set = modify.setRequestHeaders,
                remove = modify.removeRequestHeaders,
            )
            val headersBuilder = Headers.Builder()
            for ((k, v) in newHeaders) headersBuilder.add(k, v)
            rewrittenRequest = rewrittenRequest.newBuilder().headers(headersBuilder.build()).build()
        }

        val finalUrlString = rewrittenRequest.url.toString()

        var response: Response? = null
        var error: String? = null
        // See the identical field in intercept() — preserves the original exception's
        // type/stacktrace for host code that switches on the subtype.
        var networkException: IOException? = null
        try {
            response = chain.proceed(rewrittenRequest)
        } catch (e: IOException) {
            error = e.message ?: "Network error"
            networkException = e
        }

        val duration = System.currentTimeMillis() - startTime

        var respBodyText: String? = null
        var respBodySize = 0L
        var respContentType: String? = null
        response?.body?.let { body ->
            val source = body.source()
            peekResponseBody(source, config.maxBodySize)
            val buffer = source.buffer
            respBodySize = buffer.size
            respContentType = body.contentType()?.toString()
            if (isTextContentType(respContentType)) {
                respBodyText = captureBody(buffer.clone())
            }
        }

        // A Response's body can only be replaced via newBuilder().body(...), never mutated in place.
        var finalResponse = response
        if (modify != null && finalResponse != null) {
            val newStatus = modify.status ?: finalResponse.code
            val newHeadersMap = MockRuleTransform.applyHeaderEdits(
                headers = finalResponse.headers.toSingleValueMap(),
                set = modify.setResponseHeaders,
                remove = modify.removeResponseHeaders,
            )
            val newBodyText = MockRuleTransform.applyBodyReplacements(respBodyText ?: "", modify.replaceBody)

            val headersBuilder = Headers.Builder()
            for ((k, v) in newHeadersMap) headersBuilder.add(k, v)
            val ct = (
                newHeadersMap["content-type"]
                    ?: newHeadersMap["Content-Type"]
                    ?: respContentType
                    ?: "application/octet-stream"
                ).toMediaType()

            finalResponse = finalResponse.newBuilder()
                .code(newStatus)
                .headers(headersBuilder.build())
                .body(newBodyText.toResponseBody(ct))
                .build()

            respBodyText = newBodyText
            respBodySize = newBodyText.toByteArray(Charsets.UTF_8).size.toLong()
            respContentType = ct.toString()
        }

        val timing = eventListenerFactory?.consume(chain.call())

        captureProcessor.enqueue(
            RawNetworkCapture(
                id = id,
                url = finalUrlString,
                method = rewrittenRequest.method,
                startTimeMs = startTime,
                durationMs = duration,
                requestHeaders = rewrittenRequest.headers.toMultimap(),
                responseHeaders = finalResponse?.headers?.toMultimap() ?: emptyMap(),
                requestBodySize = reqBodySize,
                responseBodySize = respBodySize,
                requestContentType = reqContentType,
                responseContentType = respContentType,
                requestBody = reqBodyText,
                responseBody = respBodyText,
                status = finalResponse?.code,
                error = error,
                source = RequestSource.OKHTTP,
                timing = timing,
                correlationId = correlationId,
            )
        )

        return finalResponse ?: throw (networkException ?: IOException(error ?: "Unknown error"))
    }

    private fun captureBody(buffer: Buffer?): String? {
        buffer ?: return null
        val size = buffer.size
        if (size == 0L) return null
        val bytesToRead = minOf(size, config.maxBodySize)
        return try {
            buffer.clone().readUtf8(bytesToRead)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        /** Creates a [HakkaInterceptor] with trailing lambda configuration. */
        operator fun invoke(block: Builder.() -> Unit = {}): HakkaInterceptor =
            Builder().apply(block).build()

        /**
         * Wall-clock bound on [peekResponseBody]'s wait for [HakkaConfig.maxBodySize] bytes
         * or EOF. Keeps an unbounded stream (SSE, infinite chunked) from hanging capture —
         * see [peekResponseBody]'s doc.
         */
        private const val BODY_PEEK_TIMEOUT_MS = 3_000L

        /**
         * Buffers up to [maxBodySize] bytes from [source] without consuming it, bounded by
         * [BODY_PEEK_TIMEOUT_MS] of wall-clock time rather than only by byte count or EOF.
         * Okio's `request()` blocks until either condition is met — for a long-lived,
         * low-throughput stream (SSE heartbeats, infinite chunked transfer) that satisfies
         * neither, that would otherwise hang the calling thread for the life of the connection.
         * The deadline bounds the wait; on expiry (or any other read failure) whatever was
         * already buffered is kept and capture proceeds with a partial peek. Internal (not
         * private) so tests can drive it directly against a fake [okio.Source].
         */
        internal fun peekResponseBody(source: BufferedSource, maxBodySize: Long) {
            val timeout = source.timeout()
            val hadDeadline = timeout.hasDeadline()
            val previousDeadlineNanoTime = if (hadDeadline) timeout.deadlineNanoTime() else 0L
            timeout.deadline(BODY_PEEK_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            try {
                source.request(maxBodySize)
            } catch (_: IOException) {
                // Deadline exceeded (or another read failure) — keep whatever buffered so far.
            } finally {
                if (hadDeadline) timeout.deadlineNanoTime(previousDeadlineNanoTime) else timeout.clearDeadline()
            }
        }

        private val HTTP_STATUS_REASONS = mapOf(
            200 to "OK", 201 to "Created", 204 to "No Content",
            301 to "Moved Permanently", 302 to "Found", 304 to "Not Modified",
            400 to "Bad Request", 401 to "Unauthorized", 403 to "Forbidden",
            404 to "Not Found", 405 to "Method Not Allowed", 409 to "Conflict",
            422 to "Unprocessable Entity", 429 to "Too Many Requests",
            500 to "Internal Server Error", 502 to "Bad Gateway",
            503 to "Service Unavailable", 504 to "Gateway Timeout",
        )

        private val TEXT_TYPES = setOf(
            "text", "application/json", "application/xml", "application/javascript",
            "application/x-www-form-urlencoded", "application/graphql", "application/ld+json",
            "application/manifest+json", "application/xhtml+xml",
        )

        internal fun isTextContentType(contentType: String?): Boolean {
            if (contentType == null) return true  // unknown — attempt capture
            val lower = contentType.lowercase()
            return lower.startsWith("text/") || TEXT_TYPES.any { lower.startsWith(it) }
        }

        internal fun redactQueryItems(url: String, sensitiveItems: Set<String>): String {
            if (sensitiveItems.isEmpty()) return url
            val sensitive = sensitiveItems.map { it.lowercase() }.toSet()
            return try {
                val qStart = url.indexOf('?')
                if (qStart < 0) return url
                val base = url.substring(0, qStart)
                val rest = url.substring(qStart + 1)
                val fStart = rest.indexOf('#')
                val fragment = if (fStart >= 0) rest.substring(fStart) else ""
                val queryOnly = if (fStart >= 0) rest.substring(0, fStart) else rest
                val newQuery = queryOnly.split("&").joinToString("&") { param ->
                    val eq = param.indexOf('=')
                    if (eq < 0) param
                    else {
                        val rawName = param.substring(0, eq)
                        val decoded = java.net.URLDecoder.decode(rawName, "UTF-8")
                        if (decoded.lowercase() in sensitive) "$rawName=\u2588\u2588" else param
                    }
                }
                "$base?$newQuery$fragment"
            } catch (_: Exception) { url }
        }

        /** Returns body unchanged if not JSON; otherwise redacts [fields] recursively. */
        internal fun redactBodyFields(body: String?, contentType: String?, fields: Set<String>): String? {
            if (body == null || fields.isEmpty()) return body
            if (contentType?.lowercase()?.contains("json") != true) return body
            // Depth is checked BEFORE parsing, matching iOS, where the same
            // pattern was measured crashing: JSONSerialization recurses while
            // parsing and overflows the small stack of a concurrency task, and
            // a stack overflow is a signal no `try` can contain.
            //
            // org.json has not been observed doing that — on the JVM it raises
            // a catchable JSONException instead, and the `catch` below already
            // handles it. Android ships its own org.json, whose nesting limit
            // is undocumented and need not match the JVM's, so this makes the
            // bound explicit and identical on both platforms rather than
            // inherited from whichever implementation is present.
            if (exceedsDepthLimit(body)) return body
            val sensitive = fields.map { it.lowercase() }.toSet()
            return try {
                val json = JSONObject(body)
                redactJsonObject(json, sensitive)
                json.toString()
            } catch (_: Exception) {
                try {
                    val arr = JSONArray(body)
                    redactJsonArray(arr, sensitive)
                    arr.toString()
                } catch (_: Exception) { body }
            }
        }

        /** Last value wins for duplicate header names. */
        internal fun okhttp3.Headers.toSingleValueMap(): Map<String, String> {
            val map = LinkedHashMap<String, String>()
            for (i in 0 until size) map[name(i)] = value(i)
            return map
        }

        /**
         * Matches core-TS's `MAX_DEPTH`. A body nested past this is left alone
         * rather than recursed into: capture must never crash the host app, and
         * the body arrives from the network, so its depth is not ours to trust.
         */
        private const val MAX_REDACTION_DEPTH = 100

        /** Scan for bracket nesting past the limit without building any structure. */
        private fun exceedsDepthLimit(body: String): Boolean {
            var depth = 0
            var inString = false
            var escaped = false
            for (c in body) {
                if (escaped) {
                    escaped = false
                    continue
                }
                if (inString) {
                    when (c) {
                        '\\' -> escaped = true
                        '"' -> inString = false
                    }
                    continue
                }
                when (c) {
                    '"' -> inString = true
                    '{', '[' -> {
                        depth++
                        if (depth > MAX_REDACTION_DEPTH) return true
                    }
                    '}', ']' -> depth--
                }
            }
            return false
        }

        private fun redactJsonObject(obj: JSONObject, sensitive: Set<String>, depth: Int = 0) {
            if (depth > MAX_REDACTION_DEPTH) return
            for (key in obj.keys().asSequence().toList()) {
                if (key.lowercase() in sensitive) {
                    obj.put(key, "\u2588\u2588")
                } else {
                    when (val v = obj.opt(key)) {
                        is JSONObject -> redactJsonObject(v, sensitive, depth + 1)
                        is JSONArray -> redactJsonArray(v, sensitive, depth + 1)
                    }
                }
            }
        }

        private fun redactJsonArray(arr: JSONArray, sensitive: Set<String>, depth: Int = 0) {
            if (depth > MAX_REDACTION_DEPTH) return
            for (i in 0 until arr.length()) {
                when (val item = arr.opt(i)) {
                    is JSONObject -> redactJsonObject(item, sensitive, depth + 1)
                    is JSONArray -> redactJsonArray(item, sensitive, depth + 1)
                }
            }
        }

        /**
         * Attempts to extract a GraphQL operation name from a JSON request body.
         * Checks for explicit `operationName` field first, then parses from `query` string.
         * Returns null if the request is not a GraphQL request or has no named operation.
         */
        internal fun extractGraphQLOperationName(
            contentType: String?,
            body: String?,
            url: String,
        ): String? {
            if (body == null) return null
            val lower = contentType?.lowercase() ?: ""
            val isCandidate = lower.startsWith("application/json") ||
                lower.startsWith("application/graphql") ||
                url.contains("graphql", ignoreCase = true)
            if (!isCandidate) return null
            return try {
                val json = JSONObject(body)
                val opName = json.optString("operationName", "")
                if (opName.isNotBlank()) return opName
                val query = json.optString("query", "")
                if (query.isBlank()) return null
                Regex("""(?:query|mutation|subscription)\s+(\w+)""").find(query)?.groupValues?.get(1)
            } catch (_: Exception) {
                null
            }
        }
    }
}

/**
 * An okio [ForwardingSource] that throttles reads to simulate [ThrottleEngine.config.downloadKbps].
 *
 * On each [read] call the source reads the requested bytes from the delegate, then sleeps for
 * [ThrottleEngine.delayForBytes] milliseconds before returning, dripping data at the configured
 * bandwidth.  If the profile changes to none between reads the sleep is skipped automatically.
 */
internal class ThrottledSource(
    delegate: Source,
    private val throttle: ThrottleEngine,
) : ForwardingSource(delegate) {

    @Throws(java.io.IOException::class)
    override fun read(sink: Buffer, byteCount: Long): Long {
        val bytesRead = super.read(sink, byteCount)
        if (bytesRead > 0L && throttle.isActive) {
            val delayMs = throttle.delayForBytes(bytesRead)
            if (delayMs > 0L) {
                try {
                    Thread.sleep(delayMs)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
            }
        }
        return bytesRead
    }
}
