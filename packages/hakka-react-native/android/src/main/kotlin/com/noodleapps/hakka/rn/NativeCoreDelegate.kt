package com.noodleapps.hakka.rn

import android.content.Context
import com.facebook.react.bridge.*
import com.noodleapps.hakka.BreadcrumbRecord
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.HakkaListener
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.HttpMethod
import com.noodleapps.hakka.RequestSource
import com.noodleapps.hakka.TraceRecord
import com.noodleapps.hakka.export.CurlExporter
import com.noodleapps.hakka.export.HarExporter
import okhttp3.Interceptor
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.UUID

/**
 * Delegate that holds ALL hakka-network references.
 *
 * This class is only instantiated when hakka-network is confirmed on the classpath.
 * By isolating all hakka-network imports here, [HakkaMonitorModule] can load safely
 * even when hakka-network is absent (JS-only mode).
 */
class NativeCoreDelegate(
    private val reactContext: ReactApplicationContext,
    private val sendEvent: (String, WritableArray) -> Unit,
) {
    companion object {
        /**
         * Stable interceptor wrapper. App code adds this to its OkHttpClient:
         * ```kotlin
         * val client = OkHttpClient.Builder()
         *     .addInterceptor(NativeCoreDelegate.interceptor)
         *     .build()
         * ```
         *
         * RN caches its OkHttp client for the app lifetime, so this wrapper must
         * remain stable while the active HakkaInterceptor can be replaced.
         */
        @Volatile
        private var activeManaged: ManagedInterceptor = ManagedInterceptor(HakkaInterceptor())
        private val interceptorLock = Any()
        private val retiredInterceptors = mutableListOf<ManagedInterceptor>()

        val interceptor: Interceptor = Interceptor { chain ->
            val managed = acquireInterceptor()
            try {
                managed.interceptor.intercept(chain)
            } finally {
                releaseInterceptor(managed)
            }
        }

        private class ManagedInterceptor(val interceptor: HakkaInterceptor) {
            val wrapperCalls = AtomicInteger(0)
            @Volatile
            var dropLogsOnDrain: Boolean = false

            fun isIdle(): Boolean =
                wrapperCalls.get() == 0 && interceptor.inFlightRequests().isEmpty()
        }

        private fun acquireInterceptor(): ManagedInterceptor =
            synchronized(interceptorLock) {
                activeManaged.also { it.wrapperCalls.incrementAndGet() }
            }

        private fun releaseInterceptor(managed: ManagedInterceptor) {
            managed.wrapperCalls.decrementAndGet()
        }

        private fun currentManaged(): ManagedInterceptor =
            synchronized(interceptorLock) { activeManaged }

        private fun currentInterceptor(): HakkaInterceptor =
            currentManaged().interceptor

        /**
         * Package-accessible accessor for WS wrapper injection.
         * Returns null if hakka-network is not on the classpath.
         */
        internal fun currentInterceptorPublic(): HakkaInterceptor? = try {
            currentInterceptor()
        } catch (_: Exception) {
            null
        }

        private fun replaceInterceptor(next: HakkaInterceptor): ManagedInterceptor {
            return synchronized(interceptorLock) {
                val previous = activeManaged
                activeManaged = ManagedInterceptor(next)
                previous
            }
        }

        private fun retireOrClose(managed: ManagedInterceptor, dropLogsOnDrain: Boolean = false) {
            managed.dropLogsOnDrain = managed.dropLogsOnDrain || dropLogsOnDrain
            if (managed.isIdle()) {
                drainReadyInterceptor(managed)
                return
            }
            synchronized(interceptorLock) {
                if (!retiredInterceptors.contains(managed)) retiredInterceptors.add(managed)
            }
        }

        private fun drainRetiredIntoActive() {
            val ready = mutableListOf<ManagedInterceptor>()
            synchronized(interceptorLock) {
                val iterator = retiredInterceptors.iterator()
                while (iterator.hasNext()) {
                    val managed = iterator.next()
                    if (managed.isIdle()) {
                        ready.add(managed)
                        iterator.remove()
                    }
                }
            }
            for (managed in ready) drainReadyInterceptor(managed)
        }

        private fun drainReadyInterceptor(managed: ManagedInterceptor) {
            val retired = managed.interceptor
            retired.flushCaptureProcessing()
            synchronized(interceptorLock) {
                if (managed.dropLogsOnDrain) {
                    retired.logStore.clear()
                } else {
                    val active = activeManaged.interceptor
                    for (log in retired.logStore.all()) {
                        if (active.logStore.get(log.id) == null) active.logStore.add(log)
                    }
                }
            }
            retired.close()
        }

        private fun clearAllStoresAndDropRetired() {
            val ready = mutableListOf<ManagedInterceptor>()
            synchronized(interceptorLock) {
                activeManaged.interceptor.logStore.clear()
                val iterator = retiredInterceptors.iterator()
                while (iterator.hasNext()) {
                    val managed = iterator.next()
                    managed.dropLogsOnDrain = true
                    managed.interceptor.logStore.clear()
                    if (managed.isIdle()) {
                        ready.add(managed)
                        iterator.remove()
                    }
                }
            }
            for (managed in ready) drainReadyInterceptor(managed)
        }

        private fun resetAndCloseAll() {
            val ready = mutableListOf<ManagedInterceptor>()
            synchronized(interceptorLock) {
                val oldActive = activeManaged
                activeManaged = ManagedInterceptor(HakkaInterceptor())
                val candidates = listOf(oldActive) + retiredInterceptors.toList()
                retiredInterceptors.clear()
                for (managed in candidates) {
                    managed.dropLogsOnDrain = true
                    if (managed.isIdle()) {
                        ready.add(managed)
                    } else {
                        retiredInterceptors.add(managed)
                    }
                }
            }
            for (managed in ready) drainReadyInterceptor(managed)
        }
    }

    // Dedicated serial executor for serialization + emission — never blocks network thread.
    private val emitExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "hakka-emit").apply { isDaemon = true }
    }
    private val performanceReporter: NativePerformanceHealthReporter? = NativePerformanceLoader.create()

    // -- Observability context (session identity, tags, breadcrumbs, traces) --
    @Volatile private var sessionUserId: String? = null
    private val sessionTags = ConcurrentHashMap<String, String>()
    private val breadcrumbs = ArrayDeque<BreadcrumbRecord>()
    private val breadcrumbLock = Any()
    private val activeTraces = ConcurrentHashMap<String, TraceRecord>()
    private val maxBreadcrumbs = 100

    fun initialize(listenerCount: AtomicInteger) {
        val listener = createListener(listenerCount)
        rebuildInterceptor(listener)
        // Auto-register OkHttpClientFactory so RN's fetch uses our interceptor
        try {
            HakkaOkHttpClientFactory.initialize()
        } catch (_: Exception) {
            // OkHttpClientFactory may not be available — app must wire manually
        }
    }

    fun addLog(request: ReadableMap) {
        val mapped = requestToNetworkRequest(request) ?: return

        val logStore = currentInterceptor().logStore
        val existing = logStore.get(mapped.id)
        if (existing != null) {
            val preserved = logStore.all().filter { it.id != mapped.id }
            logStore.clear()
            for (entry in preserved) logStore.add(entry)
        }
        logStore.add(mapped)
    }

    fun getLogsJson(): String {
        drainRetiredIntoActive()
        val logs = currentInterceptor().logStore.all()
        val jsonArray = JSONArray()
        for (req in logs) {
            jsonArray.put(req.toJson())
        }
        return jsonArray.toString()
    }

    fun clearLogs() {
        clearAllStoresAndDropRetired()
    }

    fun pause() {
        currentInterceptor().pause()
    }

    fun resume() {
        currentInterceptor().resume()
    }

    fun getLogCount(): Double {
        drainRetiredIntoActive()
        return currentInterceptor().logStore.size().toDouble()
    }

    fun exportHar(): String {
        drainRetiredIntoActive()
        return HarExporter.export(currentInterceptor().logStore.all())
    }

    fun exportCurl(requestId: String): String? {
        drainRetiredIntoActive()
        val request = currentInterceptor().logStore.get(requestId) ?: return null
        return CurlExporter.export(request)
    }

    fun getPerformanceMetrics(): WritableMap {
        drainRetiredIntoActive()
        val logs = currentInterceptor().logStore.all()
        val total = logs.size
        val durations = logs.mapNotNull { it.durationMs }
        val avgResponse = if (durations.isNotEmpty()) durations.average() else 0.0
        val errors = logs.count { (it.status ?: 0) >= 400 || it.error != null }
        val successRate = if (total > 0) (total - errors).toDouble() / total else 0.0

        return Arguments.createMap().apply {
            putInt("totalRequests", total)
            putDouble("averageResponseTime", avgResponse)
            putDouble("successRate", successRate)
            putInt("errorCount", errors)
        }
    }

    fun getHealthReport(): WritableMap {
        drainRetiredIntoActive()
        val report = mergeHealthReports(
            network = currentInterceptor().healthReport(
                sessionId = sessionUserId,
                tags = sessionTags.toMap(),
            ),
            performance = performanceReporter?.healthReport(),
        )

        return Arguments.createMap().apply {
            putString("id", report.id)
            putString("kind", report.kind.value)
            putInt("schemaVersion", report.schemaVersion)
            putDouble("timestamp", report.timestampMs.toDouble())
            report.sessionId?.let { putString("sessionId", it) } ?: putNull("sessionId")
            putMap("tags", Arguments.createMap().apply {
                report.tags.forEach { (key, value) -> putString(key, value) }
            })
            putDouble("windowStart", report.windowStart.toDouble())
            putDouble("windowEnd", report.windowEnd.toDouble())
            putInt("totalRequests", report.totalRequests)
            putDouble("errorRate", report.errorRate)
            report.slowFrameRate?.let { putDouble("slowFrameRate", it) } ?: putNull("slowFrameRate")
            report.frozenFrameCount?.let { putInt("frozenFrameCount", it) } ?: putNull("frozenFrameCount")
            report.summary?.let { putString("summary", it) } ?: putNull("summary")
        }
    }

    fun rebuildWithHeaders(
        sensitiveHeaders: Set<String>,
        ignoredHosts: Set<String>,
        ignoredPatterns: Set<String>,
        listenerCount: AtomicInteger,
    ) {
        val previous = currentManaged()
        previous.interceptor.flushCaptureProcessing()
        val existingLogs = previous.interceptor.logStore.all()
        val builder = HakkaInterceptor.Builder().apply {
            redactHeaders = sensitiveHeaders.toMutableSet()
            ignoreHosts = ignoredHosts.toMutableSet()
            ignorePatterns = ignoredPatterns.toList()
        }
        builder.listener(createListener(listenerCount))
        val next = builder.build()
        for (log in existingLogs) next.logStore.add(log)
        retireOrClose(replaceInterceptor(next))
    }

    /**
     * `true` when the optional hakka-ui artifact is on the classpath —
     * [showUI] silently no-ops without it, so the JS side probes this first
     * to report failure instead of doing nothing.
     */
    fun isUIAvailable(): Boolean = try {
        Class.forName("com.noodleapps.hakka.ui.HakkaActivity")
        true
    } catch (_: ClassNotFoundException) {
        false
    }

    fun showUI(context: Context, mode: String) {
        try {
            val activity = context as? android.app.Activity
                ?: (context as? com.facebook.react.bridge.ReactApplicationContext)
                    ?.currentActivity
                ?: run {
                    android.util.Log.w("Hakka", "showUI($mode) had no effect — no current Activity")
                    return
                }

            when (mode) {
                "fullscreen" -> {
                    // Launch full-screen inspector activity
                    val intent = android.content.Intent(activity, Class.forName("com.noodleapps.hakka.ui.HakkaActivity"))
                    activity.startActivity(intent)
                }
                "sheet" -> {
                    try {
                        val sheetClass = Class.forName("com.noodleapps.hakka.ui.HakkaBottomSheet")
                        val constructor = sheetClass.getConstructor(
                            android.app.Activity::class.java,
                            Class.forName("com.noodleapps.hakka.LogStore"),
                        )
                        val sheet = constructor.newInstance(activity, currentInterceptor().logStore)
                        sheetClass.getMethod("show").invoke(sheet)
                    } catch (_: ClassNotFoundException) {
                        // hakka-ui not on classpath — no UI to show
                        android.util.Log.w("Hakka", "showUI($mode) had no effect — hakka-ui is not on the classpath")
                    }
                }
                else -> {
                    // Default: show floating bubble
                    try {
                        val bubbleClass = Class.forName("com.noodleapps.hakka.ui.HakkaBubble")
                        // getInstance() is a no-arg @JvmStatic companion function — do not
                        // pass Context, it throws NoSuchMethodException.
                        val getInstance = bubbleClass.getMethod("getInstance")
                        val bubble = getInstance.invoke(null)
                        val showMethod = bubbleClass.getMethod("show", android.app.Activity::class.java, Class.forName("com.noodleapps.hakka.LogStore"))
                        showMethod.invoke(bubble, activity, currentInterceptor().logStore)
                    } catch (_: ClassNotFoundException) {
                        // hakka-ui not on classpath — no UI to show
                        android.util.Log.w("Hakka", "showUI($mode) had no effect — hakka-ui is not on the classpath")
                    }
                }
            }
        } catch (e: Exception) {
            // SDK must never crash the host app
            android.util.Log.w("Hakka", "showUI($mode) had no effect: ${e.javaClass.simpleName}")
        }
    }

    fun hideUI(context: Context) {
        try {
            val uiClass = Class.forName("com.noodleapps.hakka.ui.HakkaUI")
            val getInstance = uiClass.getMethod("getInstance", android.content.Context::class.java)
            val ui = getInstance.invoke(null, context)
            uiClass.getMethod("hide").invoke(ui)
        } catch (_: Exception) {
            // hakka-ui not on classpath or already hidden — no-op
        }
    }

    // -- Observability --

    fun setUserId(userId: String?) {
        sessionUserId = userId
    }

    fun setTag(key: String, value: String) {
        sessionTags[key] = value
    }

    fun addBreadcrumb(name: String, attributes: Map<String, String>) {
        val crumb = BreadcrumbRecord(
            timestampMs = System.currentTimeMillis(),
            sessionId = sessionUserId,
            tags = sessionTags.toMap(),
            name = name,
            attributes = attributes,
        )
        synchronized(breadcrumbLock) {
            if (breadcrumbs.size >= maxBreadcrumbs) breadcrumbs.removeFirst()
            breadcrumbs.addLast(crumb)
        }
        // Export through the same sink fan-out as captured network records.
        currentInterceptor().injectRecord(crumb)
    }

    fun startTrace(name: String): String {
        val traceId = UUID.randomUUID().toString()
        activeTraces[traceId] = TraceRecord(
            timestampMs = System.currentTimeMillis(),
            sessionId = sessionUserId,
            tags = sessionTags.toMap(),
            name = name,
            traceId = traceId,
            spanId = UUID.randomUUID().toString(),
            startTime = System.currentTimeMillis(),
        )
        return traceId
    }

    fun setTraceAttribute(traceId: String, key: String, value: String) {
        activeTraces.computeIfPresent(traceId) { _, record ->
            record.copy(attributes = record.attributes + (key to value))
        }
    }

    fun setTraceMetric(traceId: String, key: String, value: String) {
        activeTraces.computeIfPresent(traceId) { _, record ->
            record.copy(attributes = record.attributes + ("metric.$key" to value))
        }
    }

    fun finishTrace(traceId: String) {
        // timestampMs/startTime stay at the trace's start; only endTime is stamped
        // here. status is left unset — finishTrace carries no success/error signal.
        val active = activeTraces.remove(traceId) ?: return
        currentInterceptor().injectRecord(active.copy(endTime = System.currentTimeMillis()))
    }

    /**
     * Enable native WebSocket capture. On Android this is a no-op because WS capture
     * is handled at the OkHttp layer via [HakkaWebSocketListenerWrapper] without a
     * separate opt-in.  The method exists for API symmetry with iOS.
     */
    fun enableNativeWebSocket() {
        // No-op on Android — capture is enabled automatically by HakkaOkHttpClientFactory.
    }

    /**
     * Returns true if native-layer capture is active (i.e. hakka-network is on classpath).
     */
    fun isNativeCapturing(): Boolean = true

    fun shutdown() {
        performanceReporter?.close()
        emitExecutor.shutdown()
        resetAndCloseAll()
        sessionUserId = null
        sessionTags.clear()
        activeTraces.clear()
        synchronized(breadcrumbLock) { breadcrumbs.clear() }
    }

    // -- Private --

    private fun mergeHealthReports(
        network: com.noodleapps.hakka.HealthReportRecord,
        performance: com.noodleapps.hakka.HealthReportRecord?,
    ): com.noodleapps.hakka.HealthReportRecord {
        if (performance == null) return network

        val summaries = listOfNotNull(network.summary, performance.summary)
            .distinct()
            .joinToString(" | ")
            .ifBlank { null }

        return network.copy(
            tags = network.tags + performance.tags,
            windowStart = minOf(network.windowStart, performance.windowStart),
            windowEnd = maxOf(network.windowEnd, performance.windowEnd),
            slowFrameRate = performance.slowFrameRate ?: network.slowFrameRate,
            frozenFrameCount = performance.frozenFrameCount ?: network.frozenFrameCount,
            summary = summaries,
        )
    }

    private fun createListener(listenerCount: AtomicInteger): HakkaListener {
        return HakkaListener { request ->
            if (listenerCount.get() <= 0) return@HakkaListener
            emitExecutor.execute { emitRequest(request) }
        }
    }

    private fun rebuildInterceptor(withListener: HakkaListener?) {
        val previous = currentManaged()
        previous.interceptor.flushCaptureProcessing()
        val existingLogs = previous.interceptor.logStore.all()
        val builder = HakkaInterceptor.Builder()
        withListener?.let { builder.listener(it) }
        val next = builder.build()
        for (log in existingLogs) next.logStore.add(log)
        retireOrClose(replaceInterceptor(next))
    }

    private fun emitRequest(request: NetworkRequest) {
        val map = requestToWritableMap(request)
        val array = Arguments.createArray().apply { pushMap(map) }
        sendEvent("onHakkaRequests", array)
    }

    /**
     * Converts a hakka-network [NetworkRequest] to a React Native [WritableMap].
     * Aligns with the JS [NetworkRequest] type from types.ts.
     */
    private fun requestToWritableMap(req: NetworkRequest): WritableMap {
        val map = Arguments.createMap()
        map.putString("id", req.id)
        map.putString("url", req.url)
        map.putString("method", req.method.name)
        req.status?.let { map.putInt("status", it) } ?: map.putNull("status")
        map.putDouble("startTime", req.startTimeMs.toDouble())
        req.durationMs?.let { map.putDouble("duration", it.toDouble()) } ?: map.putNull("duration")

        // Headers: multi-value → join with ", " for JS (JS uses Record<string, string>)
        map.putMap("requestHeaders", Arguments.createMap().apply {
            req.requestHeaders.forEach { (k, values) -> putString(k, values.joinToString(", ")) }
        })
        map.putMap("responseHeaders", Arguments.createMap().apply {
            req.responseHeaders.forEach { (k, values) -> putString(k, values.joinToString(", ")) }
        })

        map.putDouble("requestBodySize", req.requestBodySize.toDouble())
        map.putDouble("responseBodySize", req.responseBodySize.toDouble())
        req.requestBody?.let { map.putString("requestBody", it) } ?: map.putNull("requestBody")
        req.responseBody?.let { map.putString("responseBody", it) } ?: map.putNull("responseBody")
        req.error?.let { map.putString("error", it) } ?: map.putNull("error")
        map.putString("source", req.source.value)
        // Runtime tag so JS can distinguish native-Android from JS captures.
        map.putString("runtime", "android")

        // Timing data
        req.dnsMs?.let { map.putDouble("dnsMs", it.toDouble()) }
        req.tlsMs?.let { map.putDouble("tlsMs", it.toDouble()) }
        req.connectMs?.let { map.putDouble("connectMs", it.toDouble()) }
        req.ttfbMs?.let { map.putDouble("ttfbMs", it.toDouble()) }
        req.downloadMs?.let { map.putDouble("downloadMs", it.toDouble()) }

        // Network info
        req.protocol?.let { map.putString("networkProtocol", it) }
        req.tlsVersion?.let { map.putString("tlsVersion", it) }
        req.cipherSuite?.let { map.putString("cipherSuite", it) }

        // Redirects
        if (req.redirectCount > 0) {
            map.putInt("redirectCount", req.redirectCount)
            val urls = Arguments.createArray()
            req.redirectUrls.forEach { urls.pushString(it) }
            map.putArray("redirectUrls", urls)
        }

        // GraphQL
        req.graphqlOperationName?.let { map.putString("graphqlOperationName", it) }

        // WebSocket metadata
        req.wsMessageCount?.let { map.putInt("wsMessageCount", it) }
        req.wsCloseCode?.let { map.putInt("wsCloseCode", it) }

        return map
    }

    private fun requestToNetworkRequest(request: ReadableMap): NetworkRequest? {
        val startTime = readLong(request, "startTime") ?: readLong(request, "timestamp") ?: System.currentTimeMillis()
        val id = readString(request, "id")?.ifBlank { null }
            ?: "${currentManaged().interceptor.logStore.size()}-${System.currentTimeMillis()}-${UUID.randomUUID()}"
        val url = readString(request, "url")?.ifBlank { null } ?: return null
        val method = HttpMethod.from(readString(request, "method") ?: "GET")

        val duration = readLong(request, "duration")
        val requestHeaders = parseHeaders(readMap(request, "requestHeaders"))
        val responseHeaders = parseHeaders(readMap(request, "responseHeaders"))
        val requestBody = if (request.hasKey("requestBody") && !request.isNull("requestBody")) {
            readString(request, "requestBody")
        } else {
            null
        }
        val responseBody = if (request.hasKey("responseBody") && !request.isNull("responseBody")) {
            readString(request, "responseBody")
        } else {
            null
        }
        val error = if (request.hasKey("error") && !request.isNull("error")) {
            readString(request, "error")
        } else {
            null
        }

        val timing = readMap(request, "timing")
        val source = parseRequestSource(readString(request, "source"))

        return NetworkRequest(
            id = id,
            url = url,
            method = method,
            status = readInt(request, "status"),
            startTimeMs = startTime,
            durationMs = duration,
            requestHeaders = requestHeaders,
            responseHeaders = responseHeaders,
            requestBodySize = readLong(request, "requestBodySize") ?: 0L,
            responseBodySize = readLong(request, "responseBodySize")
                ?: readLong(request, "size") ?: 0L,
            requestBody = requestBody,
            responseBody = responseBody,
            error = error,
            source = source,
            dnsMs = timing?.let { readLong(it, "dnsMs") },
            tlsMs = timing?.let { readLong(it, "tlsMs") },
            connectMs = timing?.let { readLong(it, "connectMs") },
            ttfbMs = timing?.let { readLong(it, "ttfbMs") },
            downloadMs = timing?.let { readLong(it, "downloadMs") },
            redirectCount = (readInt(request, "redirectCount") ?: readInt(request, "redirects") ?: 0),
            redirectUrls = readStringArray(request, "redirectUrls") + readStringArray(request, "redirectChain"),
            tlsVersion = readString(request, "tlsVersion"),
            cipherSuite = readString(request, "cipherSuite"),
            protocol = readString(request, "networkProtocol"),
            graphqlOperationName = readString(request, "graphqlOperationName")
                ?: readMap(request, "graphql")?.let { rawGraphql -> readString(rawGraphql, "operationName") },
        )
    }

    private fun parseRequestSource(raw: String?): RequestSource {
        return when (raw?.lowercase()) {
            "native", "okhttp", "android", "rn_native", "js_native" -> RequestSource.OKHTTP
            "native_ws", "nativewebsocket" -> RequestSource.NATIVE_WS
            "xhr" -> RequestSource.JS_XHR
            "websocket", "ws" -> RequestSource.JS_WEBSOCKET
            "fetch", "js", "js_fetch" -> RequestSource.JS_FETCH
            else -> RequestSource.JS_FETCH
        }
    }

    private fun parseHeaders(raw: ReadableMap?): Map<String, List<String>> {
        if (raw == null) return emptyMap()

        val output = mutableMapOf<String, List<String>>()
        val iterator = raw.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            val value = when (raw.getType(key)) {
                ReadableType.String -> listOf(raw.getString(key) ?: "")
                ReadableType.Null -> emptyList()
                ReadableType.Boolean -> listOf(raw.getBoolean(key).toString())
                ReadableType.Number -> listOf(raw.getDouble(key).toString())
                ReadableType.Array -> {
                    val array = raw.getArray(key)
                    if (array == null) continue
                    mutableListOf<String>().apply {
                        for (i in 0 until array.size()) {
                            val item = when (array.getType(i)) {
                                ReadableType.String -> array.getString(i)
                                ReadableType.Number -> array.getDouble(i).toString()
                                ReadableType.Boolean -> array.getBoolean(i).toString()
                                else -> null
                            }
                            item?.let(::add)
                        }
                    }
                }

                else -> emptyList()
            }
            if (value.isNotEmpty()) {
                output[key] = value
            }
        }
        return output
    }

    private fun readMap(raw: ReadableMap, key: String): ReadableMap? =
        if (raw.hasKey(key) && !raw.isNull(key)) {
            raw.getMap(key)
        } else {
            null
        }

    private fun readString(raw: ReadableMap?, key: String): String? {
        if (raw == null || !raw.hasKey(key) || raw.isNull(key)) return null
        return when (raw.getType(key)) {
            ReadableType.String -> raw.getString(key)
            ReadableType.Number -> raw.getDouble(key).toString()
            ReadableType.Boolean -> raw.getBoolean(key).toString()
            else -> null
        }
    }

    private fun readInt(raw: ReadableMap, key: String): Int? {
        if (!raw.hasKey(key) || raw.isNull(key)) return null
        return when (raw.getType(key)) {
            ReadableType.Number -> raw.getDouble(key).toInt()
            ReadableType.String -> raw.getString(key)?.toIntOrNull()
            else -> null
        }
    }

    private fun readLong(raw: ReadableMap, key: String): Long? {
        if (!raw.hasKey(key) || raw.isNull(key)) return null
        return when (raw.getType(key)) {
            ReadableType.Number -> raw.getDouble(key).toLong()
            ReadableType.String -> raw.getString(key)?.toLongOrNull()
            else -> null
        }
    }

    private fun readStringArray(raw: ReadableMap, key: String): List<String> {
        if (!raw.hasKey(key) || raw.isNull(key)) return emptyList()
        if (raw.getType(key) != ReadableType.Array) return emptyList()
        val array = raw.getArray(key) ?: return emptyList()
        val values = mutableListOf<String>()
        for (i in 0 until array.size()) {
            val value = when (array.getType(i)) {
                ReadableType.String -> array.getString(i)
                ReadableType.Number -> array.getDouble(i).toString()
                ReadableType.Boolean -> array.getBoolean(i).toString()
                else -> null
            }
            value?.let(values::add)
        }
        return values
    }
}
