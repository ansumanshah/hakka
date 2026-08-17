package com.noodleapps.hakka.ui

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.CheckBox
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ScrollView
import android.widget.TextView
import com.noodleapps.hakka.BreakpointEngine
import com.noodleapps.hakka.BreakpointPhase
import com.noodleapps.hakka.BreakpointRule

/**
 * BreakpointsPanel — native Android UI for the [BreakpointEngine], embedded as
 * the "Breakpoints" section of [RulesTabController]'s segmented switch (Mocks |
 * Breakpoints | Throttle — see [MocksPanel] for the Mocks section).
 *
 * Two sections:
 * 1. Paused requests — entries currently blocking an OkHttp thread, with
 *    Resume / Abort actions and an inline editor for URL/headers/body or
 *    status/headers/body. Built by [buildPausedSection] (BreakpointPausedSection.kt).
 * 2. Breakpoint rules — list of rules with add/edit/toggle/delete. The add/edit
 *    dialog is [showRuleDialog] (BreakpointRuleDialogs.kt).
 *
 * The panel polls state on the main thread every 500 ms so the list stays
 * fresh while requests are in-flight. A subscribe callback notifies immediately
 * when the engine signals changes (rule edits, resume, abort). Call [onResume]/
 * [onPause] from the hosting Activity's lifecycle methods.
 */
internal class BreakpointsPanel(private val activity: Activity) {

    private val engine get() = BreakpointEngine.shared
    private val mainHandler = Handler(Looper.getMainLooper())
    private var unsubscribe: (() -> Unit)? = null

    private lateinit var pausedSection: LinearLayout
    private lateinit var rulesListView: ListView
    private lateinit var enableToggle: TextView
    private lateinit var ruleCountLabel: TextView
    private lateinit var pausedCountLabel: TextView

    private var rules: List<BreakpointRule> = emptyList()
    private var paused: List<com.noodleapps.hakka.PausedEntry> = emptyList()

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Idempotent — unsubscribes/reschedules before re-arming so calling this twice
     * in a row (the tab host now forwards both a tab-switch onShow AND the host
     * Activity's onResume to whichever section is active) never leaks a stale
     * subscription or doubles up the poller's timer chain.
     */
    fun onResume() {
        refresh()
        unsubscribe?.invoke()
        unsubscribe = engine.subscribe {
            mainHandler.post { refresh() }
        }
        mainHandler.removeCallbacks(poller)
        mainHandler.postDelayed(poller, POLL_INTERVAL_MS)
    }

    fun onPause() {
        unsubscribe?.invoke()
        unsubscribe = null
        mainHandler.removeCallbacks(poller)
    }

    private val poller: Runnable = object : Runnable {
        override fun run() {
            refresh()
            mainHandler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    // ── View construction ─────────────────────────────────────────────────────

    fun buildView(): View {
        val scroll = ScrollView(activity).apply {
            setBackgroundColor(Theme.bg(activity))
        }
        val scrollContent = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
        }

        // ── Enable toggle + add-rule row ─────────────────────────────────────
        scrollContent.addView(buildToolbar())

        // ── Paused requests section ──────────────────────────────────────────
        pausedSection = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        scrollContent.addView(pausedSection)

        // ── Rules section ────────────────────────────────────────────────────
        scrollContent.addView(buildRulesHeader())
        // ListView nested in ScrollView: use fixed-height workaround
        rulesListView = ListView(activity).apply {
            setBackgroundColor(Theme.bg(activity))
            divider = null; dividerHeight = 0
            adapter = RulesAdapter()
        }
        scrollContent.addView(rulesListView, LinearLayout.LayoutParams(MP, WC))

        scroll.addView(scrollContent)
        return scroll
    }

    private fun buildToolbar() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s12), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))

        pausedCountLabel = grayText(activity, "Loading…", 11f).apply {
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        }
        addView(pausedCountLabel)

        enableToggle = TextView(activity).apply {
            textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
            isClickable = true; isFocusable = true
            setOnClickListener {
                engine.enabled = !engine.enabled
                refresh()
                Haptics.light(activity)
            }
        }
        addView(enableToggle)

        addView(TextView(activity).apply {
            text = "+ Rule"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.accent(activity))
            setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
            isClickable = true; isFocusable = true
            setOnClickListener { showRuleDialog(activity, engine, existing = null) }
        })
    }

    private fun buildRulesHeader() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s12), dp(Theme.s8), dp(Theme.s12), dp(Theme.s8))

        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            addView(boldText(activity, "Rules", 14f))
            ruleCountLabel = grayText(activity, "", 11f)
            addView(ruleCountLabel)
        })

        addView(TextView(activity).apply {
            text = "Clear All"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.error)
            setPadding(dp(Theme.s8), dp(Theme.s4), dp(Theme.s8), dp(Theme.s4))
            isClickable = true; isFocusable = true
            setOnClickListener {
                AlertDialog.Builder(activity)
                    .setTitle("Remove all breakpoint rules?")
                    .setPositiveButton("Remove") { _, _ -> engine.clearBreakpoints() }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        })
    }

    // ── Refresh ───────────────────────────────────────────────────────────────

    private fun refresh() {
        rules = engine.getBreakpoints()
        paused = engine.getPaused()

        enableToggle.text = if (engine.enabled) "Enabled" else "Disabled"
        enableToggle.setTextColor(if (engine.enabled) Theme.success else Theme.textSecondary(activity))

        val pausedCount = paused.size
        pausedCountLabel.text = when {
            pausedCount == 0 -> "${rules.size} rules · none paused"
            pausedCount == 1 -> "${rules.size} rules · 1 paused"
            else -> "${rules.size} rules · $pausedCount paused"
        }
        ruleCountLabel.text = "${rules.size} rule${if (rules.size != 1) "s" else ""}"

        buildPausedSection(activity, engine, pausedSection, paused)

        (rulesListView.adapter as? RulesAdapter)?.notifyDataSetChanged()
        fixListViewHeight(rulesListView)
    }

    // ── Rules adapter ─────────────────────────────────────────────────────────

    private inner class RulesAdapter : BaseAdapter() {
        override fun getCount() = rules.size
        override fun getItem(pos: Int) = rules[pos]
        override fun getItemId(pos: Int) = pos.toLong()

        override fun getView(pos: Int, convertView: View?, parent: ViewGroup): View {
            val rule = rules[pos]
            val row = (convertView as? LinearLayout) ?: buildRuleRowLayout()
            bindRuleRow(row, rule)
            return row
        }
    }

    private fun buildRuleRowLayout(): LinearLayout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = ViewGroup.LayoutParams(MP, WC)

        addView(LinearLayout(activity).apply {
            tag = "rowContent"; orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(Theme.s12), dp(Theme.s10), dp(Theme.s8), dp(Theme.s10))

            addView(CheckBox(activity).apply {
                tag = "enabledCheck"; isClickable = false; isFocusable = false
            })

            addView(LinearLayout(activity).apply {
                tag = "textCol"; orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                setPadding(dp(Theme.s8), 0, 0, 0)
                addView(TextView(activity).apply { tag = "patternLabel"; textSize = GeneratedMetrics.FontSize.md.toFloat() })
                addView(TextView(activity).apply { tag = "metaLabel"; textSize = GeneratedMetrics.FontSize.sm.toFloat() })
            })

            addView(TextView(activity).apply {
                tag = "editBtn"; text = "Edit"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
                setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
                isClickable = true; isFocusable = true
            })

            addView(ImageView(activity).apply {
                tag = "deleteBtn"
                setImageResource(R.drawable.hakka_ic_close)
                val pad = dp(Theme.s8)
                setPadding(pad, dp(Theme.s6), pad, dp(Theme.s6))
                layoutParams = LinearLayout.LayoutParams(dp(36), dp(32))
                isClickable = true; isFocusable = true
                addRipple(activity)
            })
        })

        addView(View(activity).apply {
            setBackgroundColor(Theme.border(activity))
            layoutParams = LinearLayout.LayoutParams(MP, dp(1)).apply {
                setMargins(dp(Theme.s12), 0, dp(Theme.s12), 0)
            }
        })
    }

    private fun bindRuleRow(row: LinearLayout, rule: BreakpointRule) {
        val rowContent = row.findViewWithTag<LinearLayout>("rowContent")

        rowContent.findViewWithTag<CheckBox>("enabledCheck").apply {
            isChecked = rule.enabled
            setOnClickListener { engine.setEnabled(rule.id, !rule.enabled) }
        }

        val textCol = rowContent.findViewWithTag<LinearLayout>("textCol")
        textCol.findViewWithTag<TextView>("patternLabel").apply {
            text = rule.pattern.ifEmpty { "(any)" }
            setTextColor(Theme.text(activity))
            setTypeface(android.graphics.Typeface.MONOSPACE)
        }
        textCol.findViewWithTag<TextView>("metaLabel").apply {
            val method = rule.method ?: "ANY"
            val phase = when (rule.on) {
                BreakpointPhase.REQUEST -> "req"
                BreakpointPhase.RESPONSE -> "resp"
                BreakpointPhase.BOTH -> "req+resp"
            }
            val enabledStr = if (rule.enabled) "" else " · disabled"
            text = "$method · $phase$enabledStr"
            setTextColor(Theme.textSecondary(activity))
        }

        rowContent.findViewWithTag<TextView>("editBtn").apply {
            setTextColor(Theme.accent(activity))
            setOnClickListener { showRuleDialog(activity, engine, existing = rule) }
        }

        rowContent.findViewWithTag<ImageView>("deleteBtn").apply {
            setColorFilter(Theme.error)
            setOnClickListener {
                AlertDialog.Builder(activity)
                    .setTitle("Remove breakpoint?")
                    .setMessage("Pattern: '${rule.pattern}'")
                    .setPositiveButton("Remove") { _, _ -> engine.removeBreakpoint(rule.id) }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Fix ListView height when nested in a ScrollView.
     * Measures all items and sets a fixed height so the parent scroll works correctly.
     */
    private fun fixListViewHeight(lv: ListView) {
        val adapter = lv.adapter ?: run { lv.layoutParams.height = 0; return }
        val count = adapter.count
        if (count == 0) { lv.layoutParams.height = 0; lv.requestLayout(); return }
        var totalHeight = 0
        for (i in 0 until count) {
            val item = adapter.getView(i, null, lv)
            item.measure(
                View.MeasureSpec.makeMeasureSpec(lv.width, View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            )
            totalHeight += item.measuredHeight
        }
        totalHeight += lv.dividerHeight * (count - 1)
        val params = lv.layoutParams
        params.height = totalHeight
        lv.layoutParams = params
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)

    companion object {
        private const val POLL_INTERVAL_MS = 500L
    }
}
