package com.noodleapps.hakka.ui

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Logs tab — Structured/Console segmented switch, mirroring [RulesTabController]'s
 * Breakpoints/Throttle segmented-switch structure. Structured content lives in
 * [StructuredLogsPanel], console output in [ConsoleLogsPanel].
 */
internal class LogsTabController(private val activity: Activity) : TabController {

    private enum class Section { STRUCTURED, CONSOLE }

    private var section: Section = Section.STRUCTURED
    private lateinit var panelContainer: FrameLayout
    private lateinit var segHolder: LinearLayout
    // See RulesTabController's identical field for why this can't be replaced with
    // `::panelContainer.isInitialized` — panelContainer is assigned before the
    // first showSection() call, so that check is already true on the very first
    // call and would wrongly skip building the initial panel view.
    private var hasBuiltOnce = false

    private val structuredPanel by lazy { StructuredLogsPanel(activity) }
    private val consolePanel by lazy { ConsoleLogsPanel(activity) }

    override fun buildView(): View {
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(activity))
        }
        root.addView(buildHeader())
        panelContainer = FrameLayout(activity)
        root.addView(panelContainer, LinearLayout.LayoutParams(MP, 0, 1f))
        showSection(section)
        return root
    }

    override fun onShow() {
        when (section) {
            Section.STRUCTURED -> structuredPanel.onResume()
            Section.CONSOLE -> consolePanel.onResume()
        }
    }

    override fun onHide() {
        when (section) {
            Section.STRUCTURED -> structuredPanel.onPause()
            Section.CONSOLE -> consolePanel.onPause()
        }
    }

    private fun buildHeader() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(GeneratedMetrics.Layout.gutter), dp(Theme.s10), dp(GeneratedMetrics.Layout.gutter), dp(Theme.s10))

        segHolder = LinearLayout(activity).apply {
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        }
        addView(segHolder)
        rebuildSegSwitch()

        addView(TextView(activity).apply {
            text = "Clear"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.accent(activity))
            setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
            isClickable = true; isFocusable = true
            setOnClickListener {
                when (section) {
                    Section.STRUCTURED -> structuredPanel.clear()
                    Section.CONSOLE -> consolePanel.clear()
                }
            }
        })
    }

    private fun rebuildSegSwitch() {
        if (!::segHolder.isInitialized) return
        segHolder.removeAllViews()
        val labels = listOf("Structured", "Console")
        val selectedIndex = if (section == Section.STRUCTURED) 0 else 1
        segHolder.addView(buildSegmentedSwitch(activity, labels, selectedIndex) { index ->
            showSection(if (index == 0) Section.STRUCTURED else Section.CONSOLE)
        })
    }

    private fun showSection(target: Section) {
        if (hasBuiltOnce && target == section) return
        if (hasBuiltOnce) {
            when (section) {
                Section.STRUCTURED -> structuredPanel.onPause()
                Section.CONSOLE -> consolePanel.onPause()
            }
        }
        section = target
        if (hasBuiltOnce) Haptics.light(activity)
        rebuildSegSwitch()

        val view = when (target) {
            Section.STRUCTURED -> structuredPanel.buildView()
            Section.CONSOLE -> consolePanel.buildView()
        }
        panelContainer.removeAllViews()
        panelContainer.addView(view, FrameLayout.LayoutParams(MP, MP))
        when (target) {
            Section.STRUCTURED -> structuredPanel.onResume()
            Section.CONSOLE -> consolePanel.onResume()
        }
        hasBuiltOnce = true
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)
}
