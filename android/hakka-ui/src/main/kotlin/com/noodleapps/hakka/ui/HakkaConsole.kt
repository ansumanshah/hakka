package com.noodleapps.hakka.ui

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Log level for [HakkaConsole] entries. */
enum class ConsoleLevel { VERBOSE, DEBUG, INFO, WARN, ERROR }

/** A single captured console log entry. */
data class ConsoleEntry(
    val id: Int,
    val level: ConsoleLevel,
    val tag: String,
    val message: String,
    val timestampMs: Long = System.currentTimeMillis(),
)

/**
 * Public log sink for Hakka's Console panel.
 *
 * Usage:
 * ```kotlin
 * HakkaConsole.log(ConsoleLevel.INFO, "MyTag", "Hello from Hakka")
 * HakkaConsole.d("MyTag", "Debug message")
 * HakkaConsole.e("MyTag", "Error: ${throwable.message}")
 * ```
 *
 * The buffer is bounded to [MAX_ENTRIES] — oldest entries are dropped when full.
 * Thread-safe: uses [CopyOnWriteArrayList] so reads are lock-free.
 */
object HakkaConsole {
    const val MAX_ENTRIES = 500

    private val entries = CopyOnWriteArrayList<ConsoleEntry>()
    private val idCounter = AtomicInteger(0)

    // ── Public API ────────────────────────────────────────────────────────

    /** Log at the given level. */
    @JvmStatic
    fun log(level: ConsoleLevel, tag: String, message: String) {
        val entry = ConsoleEntry(
            id = idCounter.incrementAndGet(),
            level = level,
            tag = tag,
            message = message,
        )
        entries.add(entry)
        // Trim oldest if over capacity — CopyOnWriteArrayList subList().clear() is O(n), acceptable
        // for a bounded 500-item buffer on a background write path.
        while (entries.size > MAX_ENTRIES) {
            entries.removeAt(0)
        }
    }

    @JvmStatic fun v(tag: String, message: String) = log(ConsoleLevel.VERBOSE, tag, message)
    @JvmStatic fun d(tag: String, message: String) = log(ConsoleLevel.DEBUG, tag, message)
    @JvmStatic fun i(tag: String, message: String) = log(ConsoleLevel.INFO, tag, message)
    @JvmStatic fun w(tag: String, message: String) = log(ConsoleLevel.WARN, tag, message)
    @JvmStatic fun e(tag: String, message: String) = log(ConsoleLevel.ERROR, tag, message)

    // ── Read ──────────────────────────────────────────────────────────────

    /** Snapshot of all buffered entries (newest first). */
    fun all(): List<ConsoleEntry> = entries.toList().reversed()

    /** Count of buffered entries. */
    fun size(): Int = entries.size

    /** Clear the buffer. */
    fun clear() { entries.clear() }
}
