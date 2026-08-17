package com.noodleapps.hakka.rn

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/**
 * TurboModule bridge: thin layer forwarding hakka-network events to JS.
 *
 * All interception logic lives in hakka-network's HakkaInterceptor.
 * This module just:
 * - Creates and holds a HakkaInterceptor instance (if hakka-network is on classpath)
 * - Subscribes via HakkaListener to forward events to JS
 * - Exposes sync/async read methods to JS
 *
 * When hakka-network is NOT on the classpath (JS-only mode), all native methods
 * gracefully return empty/no-op results via [NativeCoreDelegate].
 *
 * Thread safety: HakkaListener callbacks fire on OkHttp's dispatcher thread.
 * We dispatch serialization and event emission to a dedicated serial executor
 * to avoid blocking the network thread.
 */
@ReactModule(name = HakkaMonitorModule.NAME)
class HakkaMonitorModule(private val reactContext: ReactApplicationContext) :
    NativeHakkaMonitorSpec(reactContext) {

    companion object {
        const val NAME = "HakkaMonitor"

        /** Whether hakka-network is available on the classpath. */
        val isNativeAvailable: Boolean = try {
            Class.forName("com.noodleapps.hakka.HakkaInterceptor")
            true
        } catch (_: ClassNotFoundException) {
            false
        } catch (_: NoClassDefFoundError) {
            false
        }
    }

    /**
     * Delegate that wraps all hakka-network interactions.
     * If hakka-network is missing, this is null and all methods return no-op results.
     */
    private val native: NativeCoreDelegate? = if (isNativeAvailable) {
        try {
            NativeCoreDelegate(reactContext, ::sendEvent)
        } catch (_: NoClassDefFoundError) {
            null
        }
    } else {
        null
    }

    // Atomic listener count — lock-free, checked on hot path.
    private val listenerCount = AtomicInteger(0)

    // Tracked state for filtering/simulation (kept in bridge even without native)
    private val sensitiveHeaders = mutableSetOf("authorization", "proxy-authorization", "cookie", "set-cookie")
    private val ignoredHosts = mutableSetOf<String>()
    private val ignoredPatterns = mutableSetOf<String>()
    private val blockedRules = mutableMapOf<String, String>()
    private val blockLock = Any()

    override fun getName(): String = NAME

    // -- Core --

    override fun initialize(promise: Promise) {
        if (native == null) {
            // JS-only mode — native not available, still "ready"
            promise.resolve(null)
            return
        }
        try {
            native.initialize(listenerCount)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", "Failed to initialize Hakka", e)
        }
    }

    override fun isReady(promise: Promise) {
        promise.resolve(true)
    }

    // -- Logs --

    override fun addLog(request: ReadableMap) {
        native?.addLog(request)
    }

    override fun getLogs(promise: Promise) {
        if (native == null) {
            promise.resolve("[]")
            return
        }
        try {
            promise.resolve(native.getLogsJson())
        } catch (e: Exception) {
            promise.reject("GET_LOGS_ERROR", "Failed to get logs", e)
        }
    }

    override fun clearLogs() {
        native?.clearLogs()
    }

    override fun pause() {
        native?.pause()
    }

    override fun resume() {
        native?.resume()
    }

    override fun getLogCount(promise: Promise) {
        promise.resolve(native?.getLogCount() ?: 0.0)
    }

    // -- Export --

    override fun exportJson(promise: Promise) {
        if (native == null) {
            promise.resolve("[]")
            return
        }
        try {
            promise.resolve(native.getLogsJson())
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", "Failed to export JSON", e)
        }
    }

    override fun exportHar(promise: Promise) {
        if (native == null) {
            promise.resolve("{}")
            return
        }
        try {
            promise.resolve(native.exportHar())
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", "Failed to export HAR", e)
        }
    }

    override fun exportCurl(requestId: String, promise: Promise) {
        if (native == null) {
            promise.reject("NO_NATIVE", "hakka-network not available — cURL export requires native SDK")
            return
        }
        try {
            val curl = native.exportCurl(requestId)
            if (curl != null) {
                promise.resolve(curl)
            } else {
                promise.reject("NOT_FOUND", "Request $requestId not found")
            }
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", "Failed to export cURL", e)
        }
    }

    // -- Analytics --

    override fun getPerformanceMetrics(promise: Promise) {
        if (native == null) {
            val map = Arguments.createMap().apply {
                putInt("totalRequests", 0)
                putDouble("averageResponseTime", 0.0)
                putDouble("successRate", 0.0)
                putInt("errorCount", 0)
            }
            promise.resolve(map)
            return
        }
        try {
            promise.resolve(native.getPerformanceMetrics())
        } catch (e: Exception) {
            promise.reject("METRICS_ERROR", "Failed to compute metrics", e)
        }
    }

    override fun getHealthReport(promise: Promise) {
        if (native == null) {
            promise.resolve(emptyHealthReport())
            return
        }
        try {
            promise.resolve(native.getHealthReport())
        } catch (e: Exception) {
            promise.reject("HEALTH_ERROR", "Failed to compute health report", e)
        }
    }

    // -- Privacy --

    override fun setSensitiveHeaders(headers: ReadableArray) {
        sensitiveHeaders.clear()
        for (i in 0 until headers.size()) {
            headers.getString(i)?.lowercase()?.let { sensitiveHeaders.add(it) }
        }
        native?.rebuildWithHeaders(sensitiveHeaders, ignoredHosts, ignoredPatterns, listenerCount)
    }

    override fun getSensitiveHeaders(promise: Promise) {
        val array = Arguments.createArray()
        for (header in sensitiveHeaders) {
            array.pushString(header)
        }
        promise.resolve(array)
    }

    override fun sanitizeLogs(promise: Promise) {
        try {
            native?.clearLogs()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SANITIZE_ERROR", "Failed to sanitize logs", e)
        }
    }

    // -- Filtering --

    override fun setIgnoredHosts(hosts: ReadableArray) {
        ignoredHosts.clear()
        for (i in 0 until hosts.size()) {
            hosts.getString(i)?.let { ignoredHosts.add(it) }
        }
        native?.rebuildWithHeaders(sensitiveHeaders, ignoredHosts, ignoredPatterns, listenerCount)
    }

    override fun getIgnoredHosts(promise: Promise) {
        val array = Arguments.createArray()
        for (host in ignoredHosts) {
            array.pushString(host)
        }
        promise.resolve(array)
    }

    override fun setIgnoredPatterns(patterns: ReadableArray) {
        ignoredPatterns.clear()
        for (i in 0 until patterns.size()) {
            patterns.getString(i)?.let { ignoredPatterns.add(it) }
        }
        native?.rebuildWithHeaders(sensitiveHeaders, ignoredHosts, ignoredPatterns, listenerCount)
    }

    override fun getIgnoredPatterns(promise: Promise) {
        val array = Arguments.createArray()
        for (pattern in ignoredPatterns) {
            array.pushString(pattern)
        }
        promise.resolve(array)
    }

    // -- Simulation --

    override fun simulateSlowNetwork(delayMs: Double) {
        HakkaMockEngine.setGlobalDelay(delayMs)
    }

    override fun blockRequests(pattern: String) {
        synchronized(blockLock) {
            if (blockedRules.containsKey(pattern)) return
            val id = HakkaMockEngine.addBlockRule(
                pattern = pattern,
                status = 503,
                headers = mapOf("Content-Type" to "application/json"),
                body = "{\"error\":\"Blocked by Hakka\"}",
            )
            blockedRules[pattern] = id
        }
    }

    override fun unblockRequests(pattern: String) {
        val id = synchronized(blockLock) {
            blockedRules.remove(pattern)
        }
        if (id != null) {
            HakkaMockEngine.removeRule(id)
        }
    }

    override fun addMockRule(rule: ReadableMap) {
        val id = readString(rule, "id") ?: return
        val pattern = readString(rule, "pattern") ?: return
        val response = HakkaMockResponse(
            status = readInt(rule, "status") ?: 200,
            headers = readStringMap(rule.getMapOrNull("headers")),
            body = readString(rule, "body") ?: "",
            delayMs = readLong(rule, "delayMs") ?: 0L,
        )
        HakkaMockEngine.addRule(
            id = id,
            pattern = pattern,
            isRegex = readBoolean(rule, "isRegex") ?: false,
            regexFlags = readString(rule, "regexFlags"),
            method = readString(rule, "method"),
            response = response,
            enabled = readBoolean(rule, "enabled") ?: true,
            redirectTo = readString(rule, "redirectTo"),
            block = readBoolean(rule, "block") ?: false,
            modify = readMockRuleModify(rule.getMapOrNull("modify")),
        )
    }

    override fun removeMockRule(id: String) {
        HakkaMockEngine.removeRule(id)
    }

    override fun setMockRuleEnabled(id: String, enabled: Boolean) {
        HakkaMockEngine.setRuleEnabled(id, enabled)
    }

    // -- Native UI --

    override fun isUIAvailable(): Boolean = native?.isUIAvailable() ?: false

    override fun showUI(mode: String) {
        native?.showUI(reactContext, mode)
    }

    override fun hideUI() {
        native?.hideUI(reactContext)
    }

    // -- Snapshot --

    override fun getSnapshot(promise: Promise) {
        if (native == null) {
            promise.resolve("[]")
            return
        }
        try {
            promise.resolve(native.getLogsJson())
        } catch (e: Exception) {
            promise.reject("SNAPSHOT_ERROR", "Failed to get snapshot", e)
        }
    }

    // -- Observability: identity & tagging --

    override fun setUserId(userId: String?) {
        native?.setUserId(userId)
    }

    override fun setTag(key: String, value: String) {
        native?.setTag(key, value)
    }

    override fun addBreadcrumb(name: String, attributes: ReadableMap) {
        native?.addBreadcrumb(name, readStringMap(attributes))
    }

    // -- Observability: distributed tracing --

    override fun startTrace(name: String, promise: Promise) {
        try {
            promise.resolve(native?.startTrace(name) ?: UUID.randomUUID().toString())
        } catch (e: Exception) {
            promise.reject("TRACE_ERROR", "Failed to start trace", e)
        }
    }

    override fun setTraceAttribute(traceId: String, key: String, value: String) {
        native?.setTraceAttribute(traceId, key, value)
    }

    override fun setTraceMetric(traceId: String, key: String, value: String) {
        native?.setTraceMetric(traceId, key, value)
    }

    override fun finishTrace(traceId: String) {
        native?.finishTrace(traceId)
    }

    // -- Events --

    override fun addListener(eventName: String) {
        listenerCount.incrementAndGet()
    }

    override fun removeListeners(count: Double) {
        val removeCount = count.toInt().coerceAtLeast(0)
        listenerCount.updateAndGet { current -> (current - removeCount).coerceAtLeast(0) }
    }

    override fun setOnNewRequestListener(callback: Callback?) {
        // Callback-based listener — handled via event emitter pattern.
        // Clients should use addListener("onHakkaRequests") instead.
    }

    private fun sendEvent(eventName: String, payload: WritableArray) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext.emitDeviceEvent(eventName, payload)
    }

    // -- Native Capture --

    override fun enableNativeWebSocket(promise: Promise) {
        native?.enableNativeWebSocket()
        promise.resolve(null)
    }

    override fun isNativeCapturing(promise: Promise) {
        promise.resolve(native?.isNativeCapturing() ?: false)
    }

    override fun invalidate() {
        listenerCount.set(0)
        native?.shutdown()
        HakkaMockEngine.clearRules()
        synchronized(blockLock) {
            blockedRules.clear()
        }
        HakkaMockEngine.setGlobalDelay(0.0)
    }

    private fun emptyHealthReport(): WritableMap =
        Arguments.createMap().apply {
            val now = System.currentTimeMillis().toDouble()
            putString("id", "health-native-unavailable")
            putString("kind", "health.report")
            putInt("schemaVersion", 1)
            putDouble("timestamp", now)
            putMap("tags", Arguments.createMap())
            putDouble("windowStart", now)
            putDouble("windowEnd", now)
            putInt("totalRequests", 0)
            putDouble("errorRate", 0.0)
            putString("summary", "native unavailable")
        }

    private fun readString(raw: ReadableMap, key: String): String? {
        if (!raw.hasKey(key) || raw.isNull(key)) return null
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

    private fun readBoolean(raw: ReadableMap, key: String): Boolean? {
        if (!raw.hasKey(key) || raw.isNull(key)) return null
        return when (raw.getType(key)) {
            ReadableType.Boolean -> raw.getBoolean(key)
            ReadableType.String -> raw.getString(key)?.toBooleanStrictOrNull()
            else -> null
        }
    }

    private fun readStringMap(raw: ReadableMap?): Map<String, String> {
        if (raw == null) return emptyMap()
        val values = linkedMapOf<String, String>()
        val iterator = raw.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            readString(raw, key)?.let { values[key] = it }
        }
        return values
    }

    private fun ReadableMap.getMapOrNull(key: String): ReadableMap? {
        if (!hasKey(key) || isNull(key)) return null
        return if (getType(key) == ReadableType.Map) getMap(key) else null
    }

    /**
     * Parses the optional `modify` block (see [MockRuleModify]) from a JS-authored mock rule.
     * Any malformed sub-field drops the WHOLE `modify` block (returns null) rather than just
     * that field — the rest of the rule is still added, matching this file's permissive style
     * for other optional fields (e.g. `regexFlags`, `method`).
     */
    private fun readMockRuleModify(raw: ReadableMap?): MockRuleModify? {
        if (raw == null) return null
        var malformed = false

        fun stringMapOrNull(key: String): Map<String, String>? {
            if (!raw.hasKey(key) || raw.isNull(key)) return null
            if (raw.getType(key) != ReadableType.Map) {
                malformed = true
                return null
            }
            val nested = raw.getMap(key) ?: return null
            val out = linkedMapOf<String, String>()
            val iterator = nested.keySetIterator()
            while (iterator.hasNextKey()) {
                val k = iterator.nextKey()
                if (nested.isNull(k) || nested.getType(k) != ReadableType.String) {
                    malformed = true
                    return null
                }
                out[k] = nested.getString(k) ?: run {
                    malformed = true
                    return null
                }
            }
            return out
        }

        fun stringArrayOrNull(key: String): List<String>? {
            if (!raw.hasKey(key) || raw.isNull(key)) return null
            if (raw.getType(key) != ReadableType.Array) {
                malformed = true
                return null
            }
            val arr = raw.getArray(key) ?: return null
            val out = mutableListOf<String>()
            for (i in 0 until arr.size()) {
                if (arr.getType(i) != ReadableType.String) {
                    malformed = true
                    return null
                }
                val s = arr.getString(i)
                if (s == null) {
                    malformed = true
                    return null
                }
                out.add(s)
            }
            return out
        }

        val setRequestHeaders = stringMapOrNull("setRequestHeaders")
        val removeRequestHeaders = stringArrayOrNull("removeRequestHeaders")
        val setQueryParams = stringMapOrNull("setQueryParams")
        val removeQueryParams = stringArrayOrNull("removeQueryParams")
        val setResponseHeaders = stringMapOrNull("setResponseHeaders")
        val removeResponseHeaders = stringArrayOrNull("removeResponseHeaders")

        var status: Int? = null
        if (raw.hasKey("status") && !raw.isNull("status")) {
            if (raw.getType("status") != ReadableType.Number) {
                malformed = true
            } else {
                status = raw.getDouble("status").toInt()
            }
        }

        var replaceBody: List<MockRuleModify.BodyReplacement>? = null
        if (raw.hasKey("replaceBody") && !raw.isNull("replaceBody")) {
            if (raw.getType("replaceBody") != ReadableType.Array) {
                malformed = true
            } else {
                val arr = raw.getArray("replaceBody")
                if (arr == null) {
                    malformed = true
                } else {
                    val out = mutableListOf<MockRuleModify.BodyReplacement>()
                    outer@ for (i in 0 until arr.size()) {
                        if (arr.getType(i) != ReadableType.Map) {
                            malformed = true
                            break@outer
                        }
                        val entry = arr.getMap(i)
                        if (entry == null) {
                            malformed = true
                            break@outer
                        }
                        val find = if (entry.hasKey("find") && entry.getType("find") == ReadableType.String) {
                            entry.getString("find")
                        } else null
                        val replace = if (entry.hasKey("replace") && entry.getType("replace") == ReadableType.String) {
                            entry.getString("replace")
                        } else null
                        if (find == null || replace == null) {
                            malformed = true
                            break@outer
                        }
                        out.add(MockRuleModify.BodyReplacement(find, replace))
                    }
                    if (!malformed) replaceBody = out
                }
            }
        }

        if (malformed) return null

        return MockRuleModify(
            setRequestHeaders = setRequestHeaders,
            removeRequestHeaders = removeRequestHeaders,
            setQueryParams = setQueryParams,
            removeQueryParams = removeQueryParams,
            status = status,
            setResponseHeaders = setResponseHeaders,
            removeResponseHeaders = removeResponseHeaders,
            replaceBody = replaceBody,
        )
    }
}
