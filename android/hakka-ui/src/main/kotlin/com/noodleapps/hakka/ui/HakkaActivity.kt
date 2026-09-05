package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Persistent tab host for the Hakka inspector — 5-tab bottom bar (Network / Stats /
 * Logs / Rules / Storage).
 *
 * Each [NavTab] is backed by a [TabController] that builds its own View once;
 * this Activity just swaps which one is attached to [contentContainer] on tab
 * switch, keeping the others' state (search text, filters, scroll position)
 * alive for the whole session. Settings is deliberately NOT a tab — it's the
 * persistent header gear, present on every tab, reached via [SettingsActivity].
 *
 * `Hakka.open()`, `HakkaUI.present()`, and the React Native native gateway all
 * launch this exact class with an [Intent]. Renaming or moving this class breaks
 * fullscreen presentation.
 */
class HakkaActivity : Activity() {

    private lateinit var headerTitle: TextView
    private lateinit var contentContainer: FrameLayout
    private val tabButtons = mutableMapOf<NavTab, TabBarButton>()
    private var currentTab: NavTab? = null

    private val controllers: Map<NavTab, TabController> by lazy {
        mapOf(
            NavTab.NETWORK to NetworkTabController(this),
            NavTab.STATS to StatsTabController(this),
            NavTab.LOGS to LogsTabController(this),
            NavTab.RULES to RulesTabController(this),
            NavTab.STORAGE to StorageTabController(this),
        )
    }

    // Built lazily, kept alive for the Activity's lifetime so switching tabs never
    // loses scroll position / search text / filter state.
    private val tabViews = mutableMapOf<NavTab, View>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val token = intent.getLongExtra(HakkaUI.FULLSCREEN_REQUEST_TOKEN, Long.MIN_VALUE)
            .takeUnless { it == Long.MIN_VALUE }
        try {
            initUI()
            if (!HakkaUI.getInstance(this).registerInspector(this, token)) finish()
        } catch (_: Exception) {
            HakkaUI.getInstance(this).rejectInspector(token)
            finish()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val token = intent.getLongExtra(HakkaUI.FULLSCREEN_REQUEST_TOKEN, Long.MIN_VALUE)
            .takeUnless { it == Long.MIN_VALUE }
        if (token != null && !HakkaUI.getInstance(this).registerInspector(this, token)) finish()
    }

    override fun onDestroy() {
        HakkaUI.getInstance(this).unregisterInspector(this)
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        currentTab?.let { controllers.getValue(it).onShow() }
    }

    override fun onPause() {
        currentTab?.let { controllers.getValue(it).onHide() }
        super.onPause()
    }

    private fun initUI() {
        window.navigationBarColor = Theme.bg(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(this@HakkaActivity))
            fitsSystemWindows = true
        }
        root.addView(buildHeader())
        contentContainer = FrameLayout(this)
        root.addView(contentContainer, LinearLayout.LayoutParams(MP, 0, 1f))
        root.addView(buildTabBar())
        setContentView(root)
        applySystemStatusBar(window, this)
        selectTab(NavTab.NETWORK)
    }

    // ── Shared header: tab title + Settings gear + close ───────────────────
    // Present on every tab — one header instead of each tab owning its own.

    private fun buildHeader() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(this@HakkaActivity))
        setPadding(dp(Theme.s16), dp(Theme.s14), dp(Theme.s8), dp(Theme.s10))

        headerTitle = boldText(context, NavTab.NETWORK.label, 16f).apply {
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        }
        addView(headerTitle)

        // Settings gear — persistent, one tap from any tab. See SettingsActivity.
        addView(iconButton(context, resources, R.drawable.hakka_ic_settings, "Settings") {
            startActivity(Intent(this@HakkaActivity, SettingsActivity::class.java))
        })

        // Close — fullscreen presentation's own dismiss; top-corner position is fine
        // for a low-frequency, once-per-session action.
        addView(TextView(context).apply {
            text = "✕"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
            contentDescription = "Close"
            setTextColor(Theme.textSecondary(this@HakkaActivity))
            setTypeface(null, Typeface.BOLD)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Theme.surfaceRaised(this@HakkaActivity))
            }
            layoutParams = LinearLayout.LayoutParams(dp(28), dp(28)).apply {
                marginStart = dp(Theme.s4)
            }
            isClickable = true; isFocusable = true
            addRipple(this@HakkaActivity)
            setOnClickListener { finish() }
        })
    }

    // ── Bottom tab bar ──────────────────────────────────────────────────────

    private data class TabBarButton(val container: LinearLayout, val icon: ImageView, val label: TextView)

    private fun buildTabBar(): LinearLayout {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Theme.surface(this@HakkaActivity))
            setPadding(0, 0, 0, navigationBarInsetPx(resources))
        }
        for (tab in NavTab.entries) {
            val button = buildTabButton(tab)
            tabButtons[tab] = button
            bar.addView(button.container, LinearLayout.LayoutParams(0, dp(64), 1f))
        }
        return bar
    }

    private fun buildTabButton(tab: NavTab): TabBarButton {
        val icon = ImageView(this).apply {
            setImageResource(tab.iconRes)
            layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
        }
        val label = TextView(this).apply {
            text = tab.label; textSize = GeneratedMetrics.FontSize.xs.toFloat(); gravity = Gravity.CENTER
            setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, 0)
            // Labels always visible — never icon-only.
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            isClickable = true; isFocusable = true
            addRipple(this@HakkaActivity)
            addView(icon)
            addView(label)
            setOnClickListener { selectTab(tab) }
        }
        return TabBarButton(container, icon, label)
    }

    private fun restyleTabButtons() {
        for ((tab, button) in tabButtons) {
            val active = tab == currentTab
            // Selected = flame accent; unselected = muted.
            val tint = if (active) Theme.accent(this) else Theme.tabInactive(this)
            button.icon.imageTintList = android.content.res.ColorStateList.valueOf(tint)
            button.label.setTextColor(tint)
            button.label.setTypeface(null, if (active) Typeface.BOLD else Typeface.NORMAL)
        }
    }

    // ── Tab switching ────────────────────────────────────────────────────

    private fun selectTab(tab: NavTab) {
        if (!::contentContainer.isInitialized) return
        if (tab == currentTab) return
        currentTab?.let { controllers.getValue(it).onHide() }
        currentTab = tab
        Haptics.light(this)
        headerTitle.text = tab.label
        restyleTabButtons()

        // Each tab's view is built once and kept alive in [tabViews] for the whole
        // session; switching tabs only ever detaches whichever view currently sits
        // in contentContainer (there's at most one) and reattaches the target's —
        // scroll position, search text, and filter state all survive the round trip.
        val view = tabViews.getOrPut(tab) { controllers.getValue(tab).buildView() }
        contentContainer.removeAllViews()
        contentContainer.addView(view, FrameLayout.LayoutParams(MP, MP))
        controllers.getValue(tab).onShow()
    }

    private fun dp(dp: Int): Int = dp(resources, dp)
}
