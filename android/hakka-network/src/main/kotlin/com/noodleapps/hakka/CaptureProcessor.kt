package com.noodleapps.hakka

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal data class RawNetworkCapture(
    val id: String,
    val url: String,
    val method: String,
    val startTimeMs: Long,
    val durationMs: Long?,
    val requestHeaders: Map<String, List<String>>,
    val responseHeaders: Map<String, List<String>>,
    val requestBodySize: Long,
    val responseBodySize: Long,
    val requestContentType: String?,
    val responseContentType: String?,
    val requestBody: String?,
    val responseBody: String?,
    val status: Int?,
    val error: String?,
    val source: RequestSource,
    val timing: HakkaEventListener.TimingData?,
    /** Trace correlation id from `x-hakka-trace`; non-null when tracing is enabled. */
    val correlationId: String? = null,
)

internal class CaptureProcessor(
    private val configProvider: () -> HakkaConfig,
    private val logStore: LogStore,
    private val listeners: List<HakkaListener>,
    private val onRecord: (ContractRecord) -> Unit,
    private val onProcessed: (String) -> Unit,
    /** Plugin-contributed request listeners, injected by [HakkaInterceptor]. May be empty. */
    private val pluginListeners: CopyOnWriteArrayList<(NetworkRequest) -> Unit> = CopyOnWriteArrayList(),
) {
    private val executor = ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(configProvider().maxRequests.coerceAtLeast(1)),
        { runnable -> Thread(runnable, "HakkaCaptureProcessor").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )

    fun enqueue(capture: RawNetworkCapture) {
        try {
            executor.execute { process(capture) }
        } catch (_: RejectedExecutionException) {
            onProcessed(capture.id)
        }
    }

    /**
     * Applies [transform] to the stored record for [id], FIFO-ordered on this same
     * single-thread executor behind the [enqueue] call that will create that record.
     *
     * This exists for callers (currently [HakkaInterceptor.schedulePatchDownloadTiming])
     * whose patch trigger — an OkHttp `callEnd`/`callFailed` callback — fires on a thread
     * with no relationship to [logStore]'s state, arbitrarily long after [id]'s capture was
     * enqueued but with no guarantee [process] has actually run for it yet. A bare
     * `logStore.update(id)` from that callback races [process]: if the single worker thread
     * hasn't reached this capture yet (queue backlog, or the patch trigger firing very
     * fast), [LogStore.update] finds no entry and silently drops the patch. Routing through
     * this executor instead makes the ordering an invariant rather than a race: the caller
     * always submits [id]'s own [enqueue] task before any code path that could trigger a
     * patch for it can run (the patch trigger needs data — e.g. a fully-drained response
     * body — that only exists after the enqueuing call site has already returned), so by
     * FIFO submission order this task is guaranteed to run after [process] has added the
     * record.
     */
    fun enqueuePatch(id: String, transform: (NetworkRequest) -> NetworkRequest) {
        try {
            executor.execute { logStore.update(id, transform) }
        } catch (_: RejectedExecutionException) {
            // Best-effort, same as enqueue()'s rejection path — no onProcessed hook needed
            // since a patch doesn't gate inFlight cleanup.
        }
    }

    fun flush(timeoutMs: Long = 5_000L): Boolean {
        val timeoutNanos = TimeUnit.MILLISECONDS.toNanos(timeoutMs.coerceAtLeast(0))
        val deadline = System.nanoTime() + timeoutNanos

        while (true) {
            val latch = CountDownLatch(1)
            try {
                executor.execute { latch.countDown() }
                val remainingNanos = if (timeoutMs <= 0) 0 else (deadline - System.nanoTime()).coerceAtLeast(0)
                return latch.await(remainingNanos, TimeUnit.NANOSECONDS)
            } catch (_: RejectedExecutionException) {
                if (executor.isShutdown) return true
                if (timeoutMs <= 0 || System.nanoTime() >= deadline) return false
                TimeUnit.MILLISECONDS.sleep(1)
            }
        }
    }

    fun close(timeoutMs: Long = 1_000L): Boolean {
        executor.shutdown()
        return executor.awaitTermination(timeoutMs, TimeUnit.MILLISECONDS)
    }

    private fun process(capture: RawNetworkCapture) {
        try {
            val cfg = configProvider()
            val requestBody = HakkaInterceptor.redactBodyFields(
                capture.requestBody,
                capture.requestContentType,
                cfg.sensitiveBodyFields,
            )
            val responseBody = HakkaInterceptor.redactBodyFields(
                capture.responseBody,
                capture.responseContentType,
                cfg.sensitiveBodyFields,
            )
            val storedUrl = HakkaInterceptor.redactQueryItems(capture.url, cfg.sensitiveQueryItems)
            val request = NetworkRequest(
                id = capture.id,
                url = storedUrl,
                method = HttpMethod.from(capture.method),
                status = capture.status,
                startTimeMs = capture.startTimeMs,
                durationMs = capture.durationMs,
                requestHeaders = redactHeaders(capture.requestHeaders),
                responseHeaders = redactHeaders(capture.responseHeaders),
                requestBodySize = capture.requestBodySize,
                responseBodySize = capture.responseBodySize,
                requestBody = requestBody,
                responseBody = responseBody,
                error = capture.error,
                source = capture.source,
                dnsMs = capture.timing?.dnsMs,
                tlsMs = capture.timing?.tlsMs,
                connectMs = capture.timing?.connectMs,
                ttfbMs = capture.timing?.ttfbMs,
                downloadMs = capture.timing?.downloadMs,
                redirectCount = capture.timing?.redirectCount ?: 0,
                redirectUrls = capture.timing?.redirectUrls?.toList() ?: emptyList(),
                tlsVersion = capture.timing?.tlsVersion,
                cipherSuite = capture.timing?.cipherSuite,
                protocol = capture.timing?.protocol,
                graphqlOperationName = HakkaInterceptor.extractGraphQLOperationName(
                    capture.requestContentType,
                    requestBody,
                    capture.url,
                ),
                correlationId = capture.correlationId,
            )
            logStore.add(request)
            onRecord(NetworkRecord.from(request, id = request.id, timestampMs = request.startTimeMs))
            listeners.forEach { listener ->
                runCatching { listener.onRequest(request) }
            }
            pluginListeners.forEach { listener ->
                runCatching { listener(request) }
            }
        } finally {
            onProcessed(capture.id)
        }
    }

    private fun redactHeaders(headers: Map<String, List<String>>): Map<String, List<String>> =
        headers.mapValues { (name, values) -> configProvider().redact(name, values) }
}
