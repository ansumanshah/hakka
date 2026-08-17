package com.noodleapps.hakka.ui

import android.content.Context
import android.util.Log
import com.noodleapps.hakka.LogLevel
import timber.log.Timber

/**
 * A [Timber.Tree] that forwards every Timber log call into Hakka's structured
 * [com.noodleapps.hakka.HakkaLogStore] — so existing `Timber.d/i/w/e(...)` call sites in
 * the host app show up in the inspector's Logs tab with zero extra code.
 *
 * Priority → [LogLevel] mapping:
 * - [Log.VERBOSE], [Log.DEBUG] → [LogLevel.DEBUG]
 * - [Log.INFO] → [LogLevel.INFO]
 * - [Log.WARN] → [LogLevel.WARN]
 * - [Log.ERROR], [Log.ASSERT] → [LogLevel.ERROR]
 *
 * Timber's `tag` becomes the structured entry's `category`; a non-null `t` (throwable)
 * is appended to the message and its class name recorded in `metadata["throwable"]`,
 * mirroring how Timber itself renders throwables into the message body.
 *
 * Timber is `compileOnly` in this module — never bundled into hakka-ui — so this class
 * only loads (and only does anything) when the host app itself depends on Timber. Plant
 * it via [plant] (or the one-liner `Hakka.plantTimber(context)`), never by constructing
 * it directly and calling `Timber.plant` yourself unless you want to skip that guard.
 */
class HakkaTimberTree private constructor(private val context: Context) : Timber.Tree() {

    override fun isLoggable(tag: String?, priority: Int): Boolean = true

    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        try {
            val level = mapPriority(priority)
            val fullMessage = if (t != null) "$message\n${Log.getStackTraceString(t)}" else message
            val metadata = t?.let { mapOf("throwable" to (it::class.qualifiedName ?: it.javaClass.name)) }
            Hakka.log(context, level, fullMessage, category = tag, metadata = metadata)
        } catch (_: Exception) {
            // A logging tree must never crash the host app or break other planted trees.
        }
    }

    private fun mapPriority(priority: Int): LogLevel = when (priority) {
        Log.VERBOSE, Log.DEBUG -> LogLevel.DEBUG
        Log.INFO -> LogLevel.INFO
        Log.WARN -> LogLevel.WARN
        Log.ERROR, Log.ASSERT -> LogLevel.ERROR
        else -> LogLevel.DEBUG
    }

    companion object {
        @Volatile private var planted = false

        /**
         * Plants a [HakkaTimberTree] into Timber, forwarding all future `Timber.*` calls
         * into the structured log store. Safe to call more than once — subsequent calls
         * are no-ops. Prefer `Hakka.plantTimber(context)`, which also guards against
         * Timber being absent from the classpath entirely.
         */
        fun plant(context: Context) {
            if (planted) return
            synchronized(this) {
                if (planted) return
                Timber.plant(HakkaTimberTree(context.applicationContext))
                planted = true
            }
        }
    }
}
