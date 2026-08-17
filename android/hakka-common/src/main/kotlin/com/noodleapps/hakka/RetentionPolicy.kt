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
     */
    fun enforce(
        deque: ArrayDeque<NetworkRequest>,
        index: HashMap<String, NetworkRequest>,
    ) {
        while (deque.size > maxRequests) {
            val removed = deque.removeFirst()
            index.remove(removed.id)
        }

        val cutoff = maxAgeMs?.let { System.currentTimeMillis() - it } ?: return
        while (deque.isNotEmpty() && deque.peekFirst().startTimeMs < cutoff) {
            val removed = deque.removeFirst()
            index.remove(removed.id)
        }
    }

    companion object {
        /** Derives a [RetentionPolicy] from a [HakkaConfig]. */
        fun from(config: HakkaConfig) = RetentionPolicy(
            maxRequests = config.maxRequests,
            maxAgeMs = config.maxAgeMs,
        )
    }
}
