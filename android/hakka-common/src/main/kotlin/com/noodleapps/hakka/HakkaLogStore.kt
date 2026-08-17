package com.noodleapps.hakka

import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * Fixed-size ring buffer of [LogEntry] records — the structured application-log
 * counterpart to the network-capture [LogStore]. Deliberately separate: this
 * store never holds [NetworkRequest]s and [LogStore] never holds [LogEntry]s.
 *
 * Mirrors `LogStore` from `packages/hakka-core/src/log/LogStore.ts`: default capacity
 * 500, oldest-evicted-first, `add` / `getEntries` (oldest→newest) / `clear` /
 * `subscribe` (returns an unsubscribe function) / `size`.
 *
 * Thread-safe via a read/write lock, matching the concurrency model of the
 * existing network [LogStore].
 */
class HakkaLogStore(private val capacity: Int = DEFAULT_CAPACITY) {
    private val lock = ReentrantReadWriteLock()
    private val buffer = ArrayDeque<LogEntry>()
    private val listeners = mutableSetOf<(LogEntry) -> Unit>()

    /** Adds an entry, evicting the oldest one if the buffer is at capacity. */
    fun add(entry: LogEntry) {
        val snapshotListeners = lock.write {
            if (buffer.size >= capacity) buffer.removeFirst()
            buffer.addLast(entry)
            listeners.toList()
        }
        for (listener in snapshotListeners) {
            try { listener(entry) } catch (_: Exception) {
                // A misbehaving listener must never break logging or other listeners.
            }
        }
    }

    /** Returns all entries oldest→newest. */
    fun getEntries(): List<LogEntry> = lock.read { buffer.toList() }

    /** Clears all stored entries. Does not affect subscribed listeners. */
    fun clear() = lock.write { buffer.clear() }

    /**
     * Subscribes to new entries as they're added. Returns an unsubscribe
     * function — call it to stop receiving notifications.
     */
    fun subscribe(listener: (LogEntry) -> Unit): () -> Unit {
        lock.write { listeners.add(listener) }
        return {
            lock.write { listeners.remove(listener) }
            Unit
        }
    }

    /** Current number of stored entries. */
    fun size(): Int = lock.read { buffer.size }

    companion object {
        const val DEFAULT_CAPACITY = 500
    }
}
