package com.noodleapps.hakka.ui

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout

/**
 * Rules tab — Mocks, Breakpoints, and Throttle under one segmented switch, mirroring
 * web's RulesTab.tsx (Mock | Breakpoints | Throttle: all three shape traffic before it
 * reaches the app, so they share a segmented switcher instead of spending separate
 * top-level entry points). "Mock this" (the one-shot action from the request detail
 * view's overflow menu) writes into the same [com.noodleapps.hakka.MockEngine] this
 * tab's Mocks section reads from — see [MocksPanel].
 *
 * Lives as one tab inside [HakkaActivity]'s persistent bottom bar. The active
 * section survives tab switches (this controller instance is kept alive by
 * [HakkaActivity] for the app session) but is not persisted across process
 * death — matching the web reference's module-level (not localStorage-backed)
 * signal.
 */
internal class RulesTabController(private val activity: Activity) : TabController {

    private enum class Section { MOCKS, BREAKPOINTS, THROTTLE }

    private var section: Section = Section.MOCKS
    private lateinit var panelContainer: FrameLayout
    private lateinit var segHolder: LinearLayout
    // Tracks whether the first section has actually been built+attached yet.
    // `::panelContainer.isInitialized` is NOT a safe proxy: it becomes true before
    // the first selectSection() call, which would wrongly skip building the panel.
    private var hasBuiltOnce = false

    private val mocksPanel by lazy { MocksPanel(activity) }
    private val breakpointsPanel by lazy { BreakpointsPanel(activity) }
    private val throttlePanel by lazy { ThrottlePanel(activity) }

    override fun buildView(): View {
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(activity))
        }
        root.addView(buildHeader())
        panelContainer = FrameLayout(activity)
        root.addView(panelContainer, LinearLayout.LayoutParams(MP, 0, 1f))
        selectSection(section)
        return root
    }

    override fun onShow() {
        when (section) {
            Section.MOCKS -> mocksPanel.onResume()
            Section.BREAKPOINTS -> breakpointsPanel.onResume()
            Section.THROTTLE -> throttlePanel.onResume()
        }
    }

    override fun onHide() {
        // Both pollable panels — harmless no-op on whichever one isn't currently active
        // (unsubscribe is null, removeCallbacks on an unarmed handler is a no-op).
        mocksPanel.onPause()
        breakpointsPanel.onPause()
    }

    private fun buildHeader() = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(GeneratedMetrics.Layout.gutter), dp(Theme.s10), dp(GeneratedMetrics.Layout.gutter), dp(Theme.s10))
        segHolder = LinearLayout(activity)
        addView(segHolder)
        rebuildSegSwitch()
    }

    private fun rebuildSegSwitch() {
        if (!::segHolder.isInitialized) return
        segHolder.removeAllViews()
        // Labels pinned to web's RulesTab.tsx and RN's RulesPanel.tsx — "Mock",
        // singular — so the switch reads identically on all four platforms.
        val labels = listOf("Mock", "Breakpoints", "Throttle")
        val selectedIndex = when (section) {
            Section.MOCKS -> 0
            Section.BREAKPOINTS -> 1
            Section.THROTTLE -> 2
        }
        segHolder.addView(buildSegmentedSwitch(activity, labels, selectedIndex) { index ->
            selectSection(when (index) { 0 -> Section.MOCKS; 1 -> Section.BREAKPOINTS; else -> Section.THROTTLE })
        })
    }

    private fun selectSection(target: Section) {
        if (hasBuiltOnce && target == section) return
        // Pause the outgoing section's lifecycle work (only Mocks + Breakpoints poll;
        // pausing either is a harmless no-op when it wasn't the active section).
        if (hasBuiltOnce) {
            mocksPanel.onPause()
            breakpointsPanel.onPause()
        }

        section = target
        if (hasBuiltOnce) Haptics.light(activity)
        rebuildSegSwitch()

        val panelView = when (target) {
            Section.MOCKS -> mocksPanel.buildView().also { mocksPanel.onResume() }
            Section.BREAKPOINTS -> breakpointsPanel.buildView().also { breakpointsPanel.onResume() }
            Section.THROTTLE -> throttlePanel.buildView().also { throttlePanel.onResume() }
        }
        panelContainer.removeAllViews()
        panelContainer.addView(panelView, FrameLayout.LayoutParams(MP, MP))
        hasBuiltOnce = true
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)
}
