package com.noodleapps.hakka

import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * No-op LogStore: all methods are no-ops, returns empty/default values.
 * Thread-safe but does nothing.
 */
class LogStore(config: HakkaConfig = HakkaConfig()) {
    private val lock = ReentrantReadWriteLock()

    fun add(request: NetworkRequest) {
    }

    fun all(): List<NetworkRequest> = lock.read { emptyList() }

    fun get(id: String): NetworkRequest? = lock.read { null }

    fun size(): Int = lock.read { 0 }

    fun query(filter: RequestFilter): List<NetworkRequest> = lock.read { emptyList() }

    fun recent(count: Int): List<NetworkRequest> = lock.read { emptyList() }

    /** No-op — always returns false (nothing stored). */
    fun update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean = false

    fun clear() = lock.write {
    }

    /** Always returns a zeroed summary — no requests captured in noop. */
    fun metricsSummary(): NetworkMetricsSummary = NetworkMetricsSummary(
        totalRequests = 0,
        completedRequests = 0,
        successCount = 0,
        errorCount = 0,
        averageResponseTimeMs = 0.0,
        successRate = 1.0,
        errorRate = 0.0,
        p95LatencyMs = null,
        totalDataTransferredBytes = 0L,
    )
}