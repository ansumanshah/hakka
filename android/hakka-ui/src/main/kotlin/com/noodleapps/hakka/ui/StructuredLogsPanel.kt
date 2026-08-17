package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import com.noodleapps.hakka.LogEntry
import com.noodleapps.hakka.LogLevel

/**
 * "Structured" segment of the Logs tab — renders [LogEntry] records from
 * [HakkaUI.hakkaLogStore]: `Hakka.log*(...)` calls and anything forwarded via
 * [HakkaTimberTree] / `Hakka.plantTimber()`. Distinct from [ConsoleLogsPanel],
 * which drains logcat plus the older unstructured [HakkaConsole] sink — this is
 * the structured-log contract (level/message/category/metadata) mirroring the
 * web core's Logs panel.
 *
 * One segment of [LogsTabController]'s Structured/Console segmented switch,
 * matching web's reference implementation.
 */
internal class StructuredLogsPanel(private val activity: Activity) {
    private var allEntries: List<LogEntry> = emptyList()
    private var filteredEntries: List<LogEntry> = emptyList()
    private val activeLevelFilters = mutableSetOf<LogLevel>()
    private val expandedIds = mutableSetOf<String>()
    private lateinit var listView: ListView
    private lateinit var filterRow: LinearLayout
    private lateinit var emptyState: LinearLayout
    private var unsubscribe: (() -> Unit)? = null

    fun onResume() {
        refresh()
        unsubscribe?.invoke()
        unsubscribe = HakkaUI.getInstance(activity).hakkaLogStore.subscribe {
            activity.runOnUiThread { refresh() }
        }
    }

    fun onPause() {
        unsubscribe?.invoke()
        unsubscribe = null
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
            adapter = LogAdapter()
        }
        emptyState = buildEmptyState(
            activity, "No structured logs yet",
            "Hakka.log*(...) calls (and anything forwarded via Timber) will appear here.",
        ).apply { visibility = View.GONE }
        val listContainer = FrameLayout(activity).apply {
            addView(listView, FrameLayout.LayoutParams(MP, MP))
            addView(emptyState, FrameLayout.LayoutParams(MP, MP))
        }
        root.addView(listContainer, LinearLayout.LayoutParams(MP, 0, 1f))
        refresh()
        return root
    }

    /** "Clear" action — surfaced by [LogsTabController]'s header for the active segment. */
    fun clear() {
        HakkaUI.getInstance(activity).hakkaLogStore.clear()
        expandedIds.clear()
        refresh()
        Toast.makeText(activity, "Logs cleared", Toast.LENGTH_SHORT).show()
    }

    // ── Level filter chips ────────────────────────────────────────────────

    private fun buildFilterRow() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s8), dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s8), dp(Theme.s8))
        addLevelLabel(this)
        for (level in LogLevel.entries) addView(levelChip(level))
    }

    private fun addLevelLabel(parent: LinearLayout) {
        parent.addView(TextView(activity).apply {
            text = "Level"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.textSecondary(activity))
            layoutParams = LinearLayout.LayoutParams(dp(44), WC)
        })
    }

    private fun levelChip(level: LogLevel): TextView {
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
        addLevelLabel(filterRow)
        for (level in LogLevel.entries) filterRow.addView(levelChip(level))
    }

    // ── Data ──────────────────────────────────────────────────────────────

    private fun refresh() {
        allEntries = HakkaUI.getInstance(activity).hakkaLogStore.getEntries().asReversed()
        applyFilters()
    }

    private fun applyFilters() {
        filteredEntries = if (activeLevelFilters.isEmpty()) allEntries
        else allEntries.filter { it.level in activeLevelFilters }
        if (::listView.isInitialized) (listView.adapter as? LogAdapter)?.notifyDataSetChanged()
        if (::emptyState.isInitialized) {
            emptyState.visibility = if (filteredEntries.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    // ── Level color ───────────────────────────────────────────────────────

    private fun levelColor(level: LogLevel): Int = when (level) {
        LogLevel.DEBUG -> Theme.textSecondary(activity)
        LogLevel.INFO -> Theme.info
        LogLevel.WARN -> Theme.warning
        LogLevel.ERROR -> Theme.error
    }

    private fun levelLabel(level: LogLevel): String = when (level) {
        LogLevel.DEBUG -> "D"
        LogLevel.INFO -> "I"
        LogLevel.WARN -> "W"
        LogLevel.ERROR -> "E"
    }

    // ── List adapter ──────────────────────────────────────────────────────

    private inner class LogAdapter : BaseAdapter() {
        override fun getCount() = filteredEntries.size
        override fun getItem(pos: Int) = filteredEntries[pos]
        override fun getItemId(pos: Int) = pos.toLong()

        override fun getView(pos: Int, convertView: View?, parent: ViewGroup): View {
            val entry = filteredEntries[pos]
            val row = buildRowLayout()
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
                addView(LinearLayout(context).apply {
                    tag = "metadataCol"; orientation = LinearLayout.VERTICAL
                    visibility = View.GONE
                    setPadding(0, dp(Theme.s4), 0, 0)
                })
            })
        })
        addView(View(context).apply {
            setBackgroundColor(Theme.border(activity))
            layoutParams = LinearLayout.LayoutParams(MP, dp(1)).apply {
                setMargins(dp(Theme.s16), 0, dp(Theme.s16), 0)
            }
        })
    }

    private fun bindRow(row: LinearLayout, entry: LogEntry) {
        val rowContent = row.findViewWithTag<LinearLayout>("rowContent")
        val color = levelColor(entry.level)

        val badge = rowContent.findViewWithTag<TextView>("badge")
        badge.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
        badge.text = levelLabel(entry.level)
        badge.setTextColor(Theme.badgeText)

        val textCol = rowContent.findViewWithTag<LinearLayout>("textCol")
        val header = buildString {
            if (!entry.category.isNullOrEmpty()) append(entry.category).append("  ")
            append(fmtTime(entry.timestamp))
        }
        textCol.findViewWithTag<TextView>("tagLabel").apply {
            text = header
            setTextColor(Theme.textSecondary(activity))
            setTypeface(null, Typeface.NORMAL)
        }
        textCol.findViewWithTag<TextView>("msgLabel").apply {
            text = entry.message
            setTextColor(if (entry.level == LogLevel.ERROR) Theme.error else Theme.text(activity))
            setTypeface(Typeface.MONOSPACE)
        }

        val metadataCol = textCol.findViewWithTag<LinearLayout>("metadataCol")
        val hasMetadata = !entry.metadata.isNullOrEmpty()
        val expanded = entry.id in expandedIds
        metadataCol.removeAllViews()
        if (hasMetadata && expanded) {
            entry.metadata?.forEach { (key, value) ->
                metadataCol.addView(TextView(activity).apply {
                    text = "$key: $value"; textSize = GeneratedMetrics.FontSize.xs.toFloat()
                    setTypeface(Typeface.MONOSPACE)
                    setTextColor(Theme.textTertiary(activity))
                    setPadding(dp(Theme.s8), dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
                })
            }
        }
        metadataCol.visibility = if (hasMetadata && expanded) View.VISIBLE else View.GONE

        rowContent.isClickable = hasMetadata
        rowContent.isFocusable = hasMetadata
        rowContent.setOnClickListener {
            if (!hasMetadata) return@setOnClickListener
            if (expanded) expandedIds.remove(entry.id) else expandedIds.add(entry.id)
            if (::listView.isInitialized) (listView.adapter as? LogAdapter)?.notifyDataSetChanged()
        }
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)
}
