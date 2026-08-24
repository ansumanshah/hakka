package com.noodleapps.hakka

import java.util.ArrayDeque

/**
 * Configures how many requests [LogStore] retains and for how long.
 * Mirrors [RetentionPolicy] on iOS.
 */
data class RetentionPolicy(
    val maxRequests: Int = 500,
    val maxAgeMs: Long? = null,
) {
    /**
     * Enforces max count and max age on the live store buffers.
     * Not part of the public API — only [LogStore] should call this.
     *
     * Returns every request evicted by this call, in eviction order, so callers that keep
     * incremental state derived from the buffer's contents (e.g. [LogStore]'s aggregate
     * metrics counters) can reverse that state for exactly what left the buffer.
     */
    fun enforce(
        deque: ArrayDeque<NetworkRequest>,
        index: HashMap<String, NetworkRequest>,
    ): List<NetworkRequest> {
        val evicted = mutableListOf<NetworkRequest>()

        while (deque.size > maxRequests) {
            val removed = deque.removeFirst()
            index.remove(removed.id)
            evicted.add(removed)
        }

        val cutoff = maxAgeMs?.let { System.currentTimeMillis() - it }
        if (cutoff != null) {
            while (deque.isNotEmpty() && deque.peekFirst().startTimeMs < cutoff) {
                val removed = deque.removeFirst()
                index.remove(removed.id)
                evicted.add(removed)
            }
        }

        return evicted
    }

    companion object {
        /** Derives a [RetentionPolicy] from a [HakkaConfig]. */
        fun from(config: HakkaConfig) = RetentionPolicy(
            maxRequests = config.maxRequests,
            maxAgeMs = config.maxAgeMs,
        )
    }
}
