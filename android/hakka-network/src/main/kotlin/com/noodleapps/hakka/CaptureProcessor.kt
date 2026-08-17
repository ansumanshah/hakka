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
