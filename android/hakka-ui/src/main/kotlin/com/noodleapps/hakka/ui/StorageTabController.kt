package com.noodleapps.hakka.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.SharedPreferences
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import com.noodleapps.hakka.StorageSnapshot
import com.noodleapps.hakka.redactLogMetadata

/**
 * Storage tab — SharedPreferences viewer.
 *
 * Scans the app's shared_prefs directory to discover all named preference files.
 * Displays all key/value pairs in a scrollable list with delete-key and clear-all
 * actions. No dangerous permissions required — SharedPreferences files live in
 * the app's own sandbox.
 *
 * Lives as one tab inside [HakkaActivity]'s persistent bottom bar.
 */
internal class StorageTabController(private val activity: Activity) : TabController {
    private data class PrefEntry(val file: String, val key: String, val value: String)

    private var allEntries: List<PrefEntry> = emptyList()
    private lateinit var listView: ListView
    private lateinit var countLabel: TextView

    override fun buildView(): View {
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(activity))
        }
        root.addView(buildHeader())
        listView = ListView(activity).apply {
            setBackgroundColor(Theme.bg(activity))
            divider = null; dividerHeight = 0
            adapter = PrefAdapter()
        }
        root.addView(listView, LinearLayout.LayoutParams(MP, 0, 1f))
        reload()
        return root
    }

    override fun onShow() {
        reload()
    }

    // ── Header ────────────────────────────────────────────────────────────

    private fun buildHeader() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s8), dp(Theme.s10), dp(Theme.s8), dp(Theme.s10))

        countLabel = TextView(activity).apply {
            textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(activity))
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        }
        addView(countLabel)

        addView(TextView(activity).apply {
            text = "Clear All"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.error)
            setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
            isClickable = true; isFocusable = true
            setOnClickListener { confirmClearAll() }
        })
    }

    // ── Data loading ──────────────────────────────────────────────────────

    private fun reload() {
        allEntries = loadAllPrefs()
        if (::countLabel.isInitialized) countLabel.text = "${allEntries.size} entries"
        if (::listView.isInitialized) (listView.adapter as? PrefAdapter)?.notifyDataSetChanged()
        publishSnapshots()
    }

    /**
     * Publishes one [StorageSnapshot] per SharedPreferences file to any connected desktop
     * bridge — mirrors iOS's `StorageView.refreshPairs()` → `publishStorageSnapshot`. Values
     * are redacted with [redactLogMetadata], the same field-name matching
     * [HakkaConfig.sensitiveBodyFields] uses everywhere else (log metadata included) —
     * storage is where credentials are *persisted*, so this must never send a raw secret.
     * No-op when [HakkaUI.attachInterceptor] was never called or no bridge is attached.
     */
    private fun publishSnapshots() {
        val interceptor = HakkaUI.getInstance(activity).interceptor ?: return
        val sensitiveFields = interceptor.config.sensitiveBodyFields
        for ((file, entriesForFile) in allEntries.groupBy { it.file }) {
            val raw = entriesForFile.associate { it.key to it.value }
            val redacted = redactLogMetadata(raw, sensitiveFields) ?: raw
            interceptor.sendStorageFrame(StorageSnapshot(store = "sharedPreferences:$file", entries = redacted))
        }
    }

    private fun loadAllPrefs(): List<PrefEntry> {
        val entries = mutableListOf<PrefEntry>()

        // Discover pref files from the shared_prefs directory
        val prefsDir = java.io.File(activity.filesDir.parent, "shared_prefs")
        val prefNames: List<String> = if (prefsDir.exists() && prefsDir.isDirectory) {
            prefsDir.listFiles()
                ?.filter { it.name.endsWith(".xml") }
                ?.map { it.name.removeSuffix(".xml") }
                ?: emptyList()
        } else {
            // Fallback: just the default prefs file
            listOf("${activity.packageName}_preferences")
        }

        for (name in prefNames) {
            try {
                val prefs: SharedPreferences = activity.getSharedPreferences(name, Activity.MODE_PRIVATE)
                for ((key, value) in prefs.all) {
                    entries.add(PrefEntry(file = name, key = key, value = valueToString(value)))
                }
            } catch (_: Exception) {
                // skip unreadable files
            }
        }

        return entries.sortedWith(compareBy({ it.file }, { it.key }))
    }

    private fun valueToString(value: Any?): String = when (value) {
        null -> "null"
        is Set<*> -> value.joinToString(", ", prefix = "{", postfix = "}")
        else -> value.toString()
    }

    // ── Actions ───────────────────────────────────────────────────────────

    private fun confirmClearAll() {
        AlertDialog.Builder(activity)
            .setTitle("Clear all SharedPreferences?")
            .setMessage("This will delete every preference entry across all files. Cannot be undone.")
            .setPositiveButton("Clear All") { _, _ -> clearAll() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun clearAll() {
        val prefsDir = java.io.File(activity.filesDir.parent, "shared_prefs")
        val prefNames: List<String> = if (prefsDir.exists() && prefsDir.isDirectory) {
            prefsDir.listFiles()
                ?.filter { it.name.endsWith(".xml") }
                ?.map { it.name.removeSuffix(".xml") }
                ?: emptyList()
        } else emptyList()

        for (name in prefNames) {
            try { activity.getSharedPreferences(name, Activity.MODE_PRIVATE).edit().clear().apply() }
            catch (_: Exception) {}
        }
        Toast.makeText(activity, "SharedPreferences cleared", Toast.LENGTH_SHORT).show()
        reload()
    }

    private fun deleteKey(entry: PrefEntry) {
        try {
            activity.getSharedPreferences(entry.file, Activity.MODE_PRIVATE).edit().remove(entry.key).apply()
            Toast.makeText(activity, "'${entry.key}' deleted", Toast.LENGTH_SHORT).show()
            reload()
        } catch (_: Exception) {
            Toast.makeText(activity, "Failed to delete key", Toast.LENGTH_SHORT).show()
        }
    }

    // ── List adapter ──────────────────────────────────────────────────────

    private inner class PrefAdapter : BaseAdapter() {
        override fun getCount() = allEntries.size
        override fun getItem(pos: Int) = allEntries[pos]
        override fun getItemId(pos: Int) = pos.toLong()

        override fun getView(pos: Int, convertView: View?, parent: ViewGroup): View {
            val entry = allEntries[pos]
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
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(Theme.s12), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
            addView(LinearLayout(context).apply {
                tag = "textCol"; orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                addView(TextView(context).apply { tag = "fileLabel"; textSize = GeneratedMetrics.FontSize.xs.toFloat() })
                addView(TextView(context).apply { tag = "keyLabel"; textSize = GeneratedMetrics.FontSize.md.toFloat() })
                addView(TextView(context).apply { tag = "valueLabel"; textSize = GeneratedMetrics.FontSize.sm.toFloat() })
            })
            addView(ImageView(context).apply {
                tag = "deleteBtn"
                setImageResource(R.drawable.hakka_ic_close)
                contentDescription = "Delete"
                val pad = dp(Theme.s8)
                setPadding(pad, pad, pad, pad)
                layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
                isClickable = true; isFocusable = true
                addRipple(activity)
            })
        })
        addView(View(context).apply {
            setBackgroundColor(Theme.border(activity))
            layoutParams = LinearLayout.LayoutParams(MP, dp(1)).apply {
                setMargins(dp(Theme.s12), 0, dp(Theme.s12), 0)
            }
        })
    }

    private fun bindRow(row: LinearLayout, entry: PrefEntry) {
        val rowContent = row.findViewWithTag<LinearLayout>("rowContent")
        val textCol = rowContent.findViewWithTag<LinearLayout>("textCol")

        textCol.findViewWithTag<TextView>("fileLabel").apply {
            text = entry.file
            setTextColor(Theme.textTertiary(activity))
        }
        textCol.findViewWithTag<TextView>("keyLabel").apply {
            text = entry.key; setTypeface(null, Typeface.BOLD)
            setTextColor(Theme.text(activity))
        }
        textCol.findViewWithTag<TextView>("valueLabel").apply {
            text = entry.value; setTypeface(Typeface.MONOSPACE)
            setTextColor(Theme.textSecondary(activity))
        }

        rowContent.findViewWithTag<ImageView>("deleteBtn").apply {
            setColorFilter(Theme.error)
            setOnClickListener {
                AlertDialog.Builder(activity)
                    .setTitle("Delete key?")
                    .setMessage("'${entry.key}' from '${entry.file}'")
                    .setPositiveButton("Delete") { _, _ -> deleteKey(entry) }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)
}
