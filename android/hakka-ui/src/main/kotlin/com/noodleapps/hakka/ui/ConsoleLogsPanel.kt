package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast

/**
 * "Console" segment of the Logs tab — shows [HakkaConsole] entries plus a bounded
 * logcat drain. One segment of [LogsTabController]'s Structured/Console switch.
 *
 * Two capture sources:
 * 1. **[HakkaConsole] sink** — structured entries added via `HakkaConsole.log(level, tag, msg)`.
 *    Always available, no permissions needed.
 * 2. **Logcat drain** — reads the last 500 logcat lines via `Runtime.exec("logcat -v time -d -T 500")`.
 *    Runs on a background thread; limited to the app's own process output (Android 4.1+ isolates
 *    per-app without READ_LOGS). Shows raw lines as VERBOSE-level entries tagged "logcat".
 */
internal class ConsoleLogsPanel(private val activity: Activity) {
    private var allEntries: List<ConsoleEntry> = emptyList()
    private var filteredEntries: List<ConsoleEntry> = emptyList()
    private val activeLevelFilters = mutableSetOf<ConsoleLevel>()
    private lateinit var listView: ListView
    private lateinit var filterRow: LinearLayout
    private lateinit var emptyState: LinearLayout
    private val mainHandler = Handler(Looper.getMainLooper())

    fun onResume() {
        refreshAndDrainLogcat()
    }

    fun onPause() {
        // No subscription to tear down — logcat drain is a one-shot background read
        // per refresh, and HakkaConsole has no push subscription API.
    }

    fun buildView(): View {
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(activity))
        }

        filterRow = buildFilterRow()
        root.addView(filterRow)
        listView = ListView(activity).apply {
            setBackgroundColor(Theme.bg(activity))
            divider = null; dividerHeight = 0
            adapter = ConsoleAdapter()
        }
        emptyState = buildEmptyState(
            activity, "No console output yet",
            "App logs and structured entries will appear here as they're captured.",
        ).apply { visibility = View.GONE }
        val listContainer = FrameLayout(activity).apply {
            addView(listView, FrameLayout.LayoutParams(MP, MP))
            addView(emptyState, FrameLayout.LayoutParams(MP, MP))
        }
        root.addView(listContainer, LinearLayout.LayoutParams(MP, 0, 1f))
        refreshAndDrainLogcat()
        return root
    }

    /** "Clear" action — surfaced by [LogsTabController]'s header for the active segment. */
    fun clear() {
        HakkaConsole.clear()
        allEntries = emptyList(); applyFilters()
        Toast.makeText(activity, "Console cleared", Toast.LENGTH_SHORT).show()
    }

    // ── Level filter chips ────────────────────────────────────────────────

    private fun buildFilterRow() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s8), dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s8), dp(Theme.s8))

        addView(TextView(context).apply {
            text = "Level"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.textSecondary(activity))
            layoutParams = LinearLayout.LayoutParams(dp(44), WC)
        })

        for (level in ConsoleLevel.entries) {
            addView(levelChip(level))
        }
    }

    private fun levelChip(level: ConsoleLevel): TextView {
        val active = level in activeLevelFilters
        val color = levelColor(level)
        val pill = GradientDrawable().apply {
            cornerRadius = dp(Theme.radiusM).toFloat()
            if (active) { setColor(color); setStroke(0, 0) }
            else { setColor(Color.TRANSPARENT); setStroke(dp(1), Theme.border(activity)) }
        }
        return TextView(activity).apply {
            text = level.name.take(1); textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
            setTextColor(if (active) Theme.badgeText else Theme.textSecondary(activity))
            setTypeface(null, Typeface.BOLD)
            background = pill
            setPadding(dp(Theme.s8), dp(Theme.s4), dp(Theme.s8), dp(Theme.s4))
            layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                setMargins(0, 0, dp(Theme.s6), 0)
            }
            addRipple(activity)
            setOnClickListener {
                if (activeLevelFilters.contains(level)) activeLevelFilters.remove(level)
                else activeLevelFilters.add(level)
                rebuildFilterChips()
                applyFilters()
            }
        }
    }

    private fun rebuildFilterChips() {
        filterRow.removeAllViews()
        filterRow.addView(TextView(activity).apply {
            text = "Level"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.textSecondary(activity))
            layoutParams = LinearLayout.LayoutParams(dp(44), WC)
        })
        for (level in ConsoleLevel.entries) {
            filterRow.addView(levelChip(level))
        }
    }

    // ── Data ──────────────────────────────────────────────────────────────

    private fun refreshAndDrainLogcat() {
        // 1. Load HakkaConsole entries immediately
        allEntries = HakkaConsole.all()
        applyFilters()

        // 2. Drain logcat on a background thread (non-blocking)
        Thread {
            val logcatEntries = drainLogcat()
            mainHandler.post {
                // Merge: HakkaConsole entries first (higher priority / structured), then logcat
                allEntries = HakkaConsole.all() + logcatEntries
                applyFilters()
            }
        }.start()
    }

    private fun drainLogcat(): List<ConsoleEntry> {
        return try {
            // -d = dump and exit; -T 500 = last 500 lines (API 26+); -v time for timestamp prefix
            val process = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-v", "time", "-T", "500"))
            val lines = process.inputStream.bufferedReader().readLines()
            process.destroy()
            lines.mapNotNull { parseLogcatLine(it) }.take(HakkaConsole.MAX_ENTRIES)
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Parse a logcat line like:
     *   `06-22 10:30:45.123  1234  5678 D MyTag  : My message`
     * or the `-v time` format:
     *   `06-22 10:30:45.123 D/MyTag( 1234): My message`
     */
    private fun parseLogcatLine(line: String): ConsoleEntry? {
        if (line.isBlank()) return null
        val level = when {
            line.contains(" V/") || line.contains(" V ") -> ConsoleLevel.VERBOSE
            line.contains(" D/") || line.contains(" D ") -> ConsoleLevel.DEBUG
            line.contains(" I/") || line.contains(" I ") -> ConsoleLevel.INFO
            line.contains(" W/") || line.contains(" W ") -> ConsoleLevel.WARN
            line.contains(" E/") || line.contains(" E ") -> ConsoleLevel.ERROR
            else -> ConsoleLevel.DEBUG
        }
        return ConsoleEntry(
            id = System.nanoTime().toInt(),
            level = level,
            tag = "logcat",
            message = line.trim(),
        )
    }

    private fun applyFilters() {
        filteredEntries = if (activeLevelFilters.isEmpty()) allEntries
        else allEntries.filter { it.level in activeLevelFilters }
        if (::listView.isInitialized) (listView.adapter as? ConsoleAdapter)?.notifyDataSetChanged()
        if (::emptyState.isInitialized) {
            emptyState.visibility = if (filteredEntries.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    // ── Level color ───────────────────────────────────────────────────────

    private fun levelColor(level: ConsoleLevel): Int = when (level) {
        ConsoleLevel.VERBOSE -> Theme.textSecondary(activity)
        ConsoleLevel.DEBUG -> Theme.info // steel — reserved for info-level semantics
        ConsoleLevel.INFO -> Theme.info // steel — console info level per Wok Hei grammar
        ConsoleLevel.WARN -> Theme.warning
        ConsoleLevel.ERROR -> Theme.error
    }

    private fun levelLabel(level: ConsoleLevel): String = when (level) {
        ConsoleLevel.VERBOSE -> "V"
        ConsoleLevel.DEBUG -> "D"
        ConsoleLevel.INFO -> "I"
        ConsoleLevel.WARN -> "W"
        ConsoleLevel.ERROR -> "E"
    }

    // ── List adapter ──────────────────────────────────────────────────────

    private inner class ConsoleAdapter : BaseAdapter() {
        override fun getCount() = filteredEntries.size
        override fun getItem(pos: Int) = filteredEntries[pos]
        override fun getItemId(pos: Int) = filteredEntries[pos].id.toLong()

        override fun getView(pos: Int, convertView: View?, parent: ViewGroup): View {
            val entry = filteredEntries[pos]
            val row = (convertView as? LinearLayout) ?: buildRowLayout()
            bindRow(row, entry)
            return row
        }
    }

    private fun buildRowLayout() = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = ViewGroup.LayoutParams(MP, WC)
        addView(LinearLayout(context).apply {
            tag = "rowContent"; orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
            setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
            addView(TextView(context).apply {
                tag = "badge"; textSize = GeneratedMetrics.FontSize.xxs.toFloat(); gravity = Gravity.CENTER
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(dp(16), dp(16)).apply {
                    setMargins(0, dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s6), 0)
                }
            })
            addView(LinearLayout(context).apply {
                tag = "textCol"; orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                addView(TextView(context).apply { tag = "tagLabel"; textSize = GeneratedMetrics.FontSize.xs.toFloat() })
                addView(TextView(context).apply { tag = "msgLabel"; textSize = GeneratedMetrics.FontSize.sm.toFloat() })
            })
        })
        addView(View(context).apply {
            setBackgroundColor(Theme.border(activity))
            layoutParams = LinearLayout.LayoutParams(MP, dp(1)).apply {
                setMargins(dp(Theme.s16), 0, dp(Theme.s16), 0)
            }
        })
    }

    private fun bindRow(row: LinearLayout, entry: ConsoleEntry) {
        val rowContent = row.findViewWithTag<LinearLayout>("rowContent")
        val color = levelColor(entry.level)

        val badge = rowContent.findViewWithTag<TextView>("badge")
        val badgeBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL; setColor(color)
        }
        badge.background = badgeBg
        badge.text = levelLabel(entry.level)
        badge.setTextColor(Theme.badgeText)

        val textCol = rowContent.findViewWithTag<LinearLayout>("textCol")
        textCol.findViewWithTag<TextView>("tagLabel").apply {
            text = "${entry.tag}  ${fmtTime(entry.timestampMs)}"
            setTextColor(Theme.textSecondary(activity))
            setTypeface(null, Typeface.NORMAL)
        }
        textCol.findViewWithTag<TextView>("msgLabel").apply {
            text = entry.message
            setTextColor(if (entry.level == ConsoleLevel.ERROR) Theme.error else Theme.text(activity))
            setTypeface(Typeface.MONOSPACE)
        }
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)
}
