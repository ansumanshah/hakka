package com.noodleapps.hakka

import java.util.ArrayDeque
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * Protocol for request storage backends.
 * Ships with [InMemoryStorage] for v1 and can be replaced by MMKV/SQLite later.
 */
interface StorageAdapter {
    fun store(request: NetworkRequest)
    fun query(filter: RequestFilter): List<NetworkRequest>
    fun clear()
    val count: Int
}

/** Filter criteria for querying stored requests. */
data class RequestFilter(
    val urlPattern: String? = null,
    val method: String? = null,
    val statusRange: IntRange? = null,
    val since: Long? = null,
) {
    fun matches(request: NetworkRequest): Boolean {
        urlPattern?.let { if (!request.url.contains(it)) return false }
        method?.let { if (request.method.name != it) return false }
        statusRange?.let {
            val status = request.status ?: return false
            if (status !in it) return false
        }
        since?.let { if (request.startTimeMs < it) return false }
        return true
    }
}

/** In-memory bounded request storage for local-first snapshots. */
class InMemoryStorage(private val config: HakkaConfig) : StorageAdapter {
    private val lock = ReentrantReadWriteLock()
    private val deque = ArrayDeque<NetworkRequest>()
    private val index = HashMap<String, NetworkRequest>()

    override fun store(request: NetworkRequest) = lock.write {
        deque.addLast(request)
        index[request.id] = request
        enforceRetention()
    }

    override fun query(filter: RequestFilter): List<NetworkRequest> =
        lock.read { deque.filter { filter.matches(it) } }

    override fun clear() = lock.write {
        deque.clear()
        index.clear()
    }

    override val count: Int
        get() = lock.read { deque.size }

    private fun enforceRetention() {
        while (deque.size > config.maxRequests) {
            val removed = deque.removeFirst()
            index.remove(removed.id)
        }

        val maxAge = config.maxAgeMs ?: return
        val cutoff = System.currentTimeMillis() - maxAge
        while (deque.isNotEmpty() && deque.peekFirst().startTimeMs < cutoff) {
            val removed = deque.removeFirst()
            index.remove(removed.id)
        }
    }
}
