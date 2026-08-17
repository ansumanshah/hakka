package com.noodleapps.hakka

import java.util.ArrayDeque
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * Thread-safe ring buffer for storing [NetworkRequest] entries.
 * O(1) add, O(1) lookup by ID via HashMap. Enforces [RetentionPolicy] on every add.
 * Maintains incremental aggregate counters so [metricsSummary] is O(1) without a full scan.
 *
 * While [paused], incoming requests are buffered in [pauseBuffer] instead of the main ring.
 * Calling [resume] drains the buffer into the ring in arrival order.
 */
class LogStore(config: HakkaConfig) {
    private val lock = ReentrantReadWriteLock()
    private val deque = ArrayDeque<NetworkRequest>()
    private val index = HashMap<String, NetworkRequest>()

    @Volatile private var retentionPolicy: RetentionPolicy = RetentionPolicy.from(config)

    @Volatile var isPaused: Boolean = false
        private set
    private val pauseBuffer = ArrayDeque<NetworkRequest>()

    // Incremental metrics counters — updated on every add/clear under the write lock.
    private var mTotalRequests = 0
    private var mCompletedRequests = 0
    private var mSuccessCount = 0
    private var mErrorCount = 0
    private var mDurationTotalMs = 0L
    private val mDurationsById = HashMap<String, Long>() // id -> durationMs
    private var mTotalDataBytes = 0L

    /** Adds a request to the store. While [isPaused], requests are buffered and not yet visible. */
    fun add(request: NetworkRequest) = lock.write {
        if (isPaused) {
            pauseBuffer.addLast(request)
        } else {
            deque.addLast(request)
            index[request.id] = request
            addMetrics(request)
            retentionPolicy.enforce(deque, index)
        }
    }

    /**
     * Pauses capture: subsequent [add] calls buffer the request instead of storing it.
     * Already-stored requests remain visible. Idempotent.
     */
    fun pause() = lock.write { isPaused = true }

    /**
     * Resumes capture: drains the pause buffer into the ring in arrival order,
     * then re-enables direct storage. Idempotent.
     */
    fun resume() = lock.write {
        isPaused = false
        while (pauseBuffer.isNotEmpty()) {
            val req = pauseBuffer.removeFirst()
            deque.addLast(req)
            index[req.id] = req
            addMetrics(req)
        }
        retentionPolicy.enforce(deque, index)
    }

    /** Returns a snapshot of all stored requests. */
    fun all(): List<NetworkRequest> = lock.read { deque.toList() }

    /** Looks up a request by ID. O(1). */
    fun get(id: String): NetworkRequest? = lock.read { index[id] }

    /** Current number of stored requests. */
    fun size(): Int = lock.read { deque.size }

    /** Queries stored requests matching the given filter. Thread-safe. */
    fun query(filter: RequestFilter): List<NetworkRequest> = lock.read {
        deque.filter { filter.matches(it) }
    }

    /** Returns the last [count] requests, newest first. */
    fun recent(count: Int): List<NetworkRequest> = lock.read {
        deque.toList().takeLast(count).reversed()
    }

    /**
     * Applies [transform] to the stored request with [id].
     * Returns true if the request was found and replaced, false if unknown.
     *
     * Used by [HakkaPluginContextImpl.update] so plugins can merge partial changes into
     * existing log entries (e.g. attaching parsed metadata after capture).
     */
    fun update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean = lock.write {
        val existing = index[id] ?: return@write false
        val updated = transform(existing)
        index[id] = updated
        val pos = deque.indexOf(existing)
        if (pos >= 0) {
            val list = deque.toMutableList()
            list[pos] = updated
            deque.clear()
            deque.addAll(list)
        }
        true
    }

    /** Clears all stored requests and resets aggregate counters. */
    fun clear() = lock.write {
        deque.clear()
        index.clear()
        resetMetrics()
    }

    /** Updates the active retention policy. Called by [HakkaInterceptor.updateConfig]. */
    internal fun updateRetentionPolicy(policy: RetentionPolicy) {
        retentionPolicy = policy
    }

    /**
     * Returns aggregate metrics over the current in-memory buffer.
     * Runs in O(n log n) for p95 (sort of durations); all other fields are O(1).
     * Mirrors [NetworkMetricsSummary] from HakkaCommon (iOS).
     */
    fun metricsSummary(): NetworkMetricsSummary = lock.read {
        val durations = mDurationsById.values.toLongArray().also { it.sort() }
        val p95 = if (durations.size >= 2) {
            val idx = (durations.size * 0.95).toInt().coerceIn(0, durations.size - 1)
            durations[idx]
        } else null
        val avgMs = if (mDurationsById.isEmpty()) 0.0
                    else mDurationTotalMs.toDouble() / mDurationsById.size
        NetworkMetricsSummary(
            totalRequests = mTotalRequests,
            completedRequests = mCompletedRequests,
            successCount = mSuccessCount,
            errorCount = mErrorCount,
            averageResponseTimeMs = avgMs,
            successRate = if (mTotalRequests == 0) 1.0 else mSuccessCount.toDouble() / mTotalRequests,
            errorRate = if (mTotalRequests == 0) 0.0 else mErrorCount.toDouble() / mTotalRequests,
            p95LatencyMs = p95,
            totalDataTransferredBytes = mTotalDataBytes,
        )
    }

    // ---- Private helpers ----

    private fun addMetrics(req: NetworkRequest) {
        mTotalRequests++
        val status = req.status
        val hasStatus = status != null && status > 0
        val hasError = req.error != null
        if (hasStatus || hasError) mCompletedRequests++
        if (hasStatus && status != null && status in 200..399) mSuccessCount++
        if (hasError || (hasStatus && status != null && status >= 400)) mErrorCount++
        req.durationMs?.let { d ->
            mDurationTotalMs += d
            mDurationsById[req.id] = d
        }
        mTotalDataBytes += req.responseBodySize
    }

    private fun resetMetrics() {
        mTotalRequests = 0
        mCompletedRequests = 0
        mSuccessCount = 0
        mErrorCount = 0
        mDurationTotalMs = 0L
        mDurationsById.clear()
        mTotalDataBytes = 0L
    }
}
