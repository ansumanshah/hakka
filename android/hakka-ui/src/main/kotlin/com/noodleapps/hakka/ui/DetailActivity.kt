package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.noodleapps.hakka.NetworkRequest

/**
 * Tab-based request detail view with Overview, Request, Response, Timing tabs.
 *
 * This class owns only the shell: header, tab bar, and tab dispatch. Each tab's
 * content builder lives in its own file (`DetailOverviewTab.kt`,
 * `DetailRequestTab.kt`, `DetailResponseTab.kt`, `DetailTimingTab.kt`,
 * `DetailFramesTab.kt`, `DetailGraphQLTab.kt`) as an `internal` extension
 * function on [DetailActivity], plus shared cross-tab helpers
 * (`DetailShared.kt` for KV rows, `DetailCookies.kt`, `DetailBodyContent.kt`
 * for the body/search viewer, `DetailActions.kt` for the overflow menu) — the
 * same shape as the TS `Detail.tsx` + `Detail*Tab.tsx` split.
 */
class DetailActivity : Activity() {
    private var currentTab = 0
    internal lateinit var contentLayout: LinearLayout
    internal lateinit var scrollView: ScrollView
    internal lateinit var request: NetworkRequest
    private val tabViews = mutableListOf<TextView>()
    internal val searchHandler = Handler(Looper.getMainLooper())
    internal var pendingSearchRunnable: Runnable? = null
    // Decoded/Raw toggle for query-params and form-urlencoded body. Survives tab switches.
    internal var urlDecoded = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try { initUI() } catch (_: Exception) { finish() }
    }

    private fun initUI() {
        val reqId = intent.getStringExtra(EXTRA_REQUEST_ID)
        val r = reqId?.let { HakkaUI.getInstance(this).logStore?.get(it) }
        if (r == null) { finish(); return }
        request = r
        window.navigationBarColor = Theme.bg(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Theme.bg(this@DetailActivity))
            fitsSystemWindows = true
        }
        root.addView(buildCompactHeader())
        root.addView(buildTabBar())
        contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // Reduced side padding on phones (Wok Hei width-effectiveness) — the pane's
            // first/last columns should sit close to the screen edge, not double-inset.
            setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s16))
        }
        scrollView = ScrollView(this).apply {
            setBackgroundColor(Theme.bg(this@DetailActivity)); addView(contentLayout)
        }
        root.addView(scrollView, LinearLayout.LayoutParams(MP, 0, 1f))
        setContentView(root)
        applySystemStatusBar(window, this)
        rebuildTabContent()
    }

    // ── Compact header ───────────────────────────────────────────────────
    // Back button (circle) + method badge + path + status + duration — all in one row

    private fun buildCompactHeader() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setBackgroundColor(Theme.surface(this@DetailActivity))
        setPadding(dp(Theme.s8), dp(Theme.s10), dp(Theme.s12), dp(Theme.s8))
        addView(hRow(context) {
            addView(ImageView(context).apply {
                setImageResource(R.drawable.hakka_ic_back)
                setColorFilter(Theme.text(this@DetailActivity))
                val circle = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Theme.surfaceRaised(this@DetailActivity))
                }
                background = circle
                layoutParams = LinearLayout.LayoutParams(dp(32), dp(32)).apply {
                    gravity = Gravity.CENTER_VERTICAL; setMargins(0, 0, dp(Theme.s8), 0)
                }
                isClickable = true; isFocusable = true
                addRipple(this@DetailActivity)
                setOnClickListener { finish() }
            })
            addView(methodChip(this@DetailActivity, request.method.name))
            addView(TextView(context).apply {
                text = pathText(request); textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(Typeface.MONOSPACE)
                setTextColor(Theme.text(this@DetailActivity)); maxLines = 1
                setPadding(dp(Theme.s6), 0, dp(Theme.s4), 0)
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            })
            request.status?.let { code ->
                val statusPill = GradientDrawable().apply {
                    setColor(barColor(code)); cornerRadius = dp(Theme.radiusS).toFloat()
                }
                addView(TextView(context).apply {
                    text = "$code"; textSize = GeneratedMetrics.FontSize.xs.toFloat(); gravity = Gravity.CENTER
                    setTextColor(Theme.badgeText); setTypeface(null, Typeface.BOLD)
                    background = statusPill; setPadding(dp(Theme.s6), dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s6), dp(GeneratedMetrics.Spacing.xxs))
                })
            }
            request.durationMs?.let { ms ->
                addView(TextView(context).apply {
                    text = fmtDuration(ms); textSize = GeneratedMetrics.FontSize.sm.toFloat()
                    setTextColor(durationColor(this@DetailActivity, ms))
                    setTypeface(Typeface.MONOSPACE)
                    setPadding(dp(Theme.s6), 0, 0, 0)
                })
            }
            // Overflow — one entry point for the four co-equal, low-frequency actions
            // (Copy cURL / Copy URL / Share / Postman / Mock this) instead of a permanently
            // docked, flame-filled 3-button bar. None of these is "the" primary action, so
            // none should hold the accent permanently.
            addView(iconButton(context, resources, R.drawable.hakka_ic_more) { showActionsMenu() })
        })
    }

    // ── Tab bar ──────────────────────────────────────────────────────────

    private fun buildTabBar() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
        setBackgroundColor(Theme.surface(this@DetailActivity))
        setPadding(dp(Theme.s8), dp(Theme.s4), dp(Theme.s8), dp(Theme.s8))
        tabViews.clear()
        val tabLabels = buildList {
            add("Overview"); add("Request"); add("Response"); add("Timing")
            if (request.graphqlOperationName != null || isGraphQLRequest(request)) add("GraphQL")
            if (request.wsMessages.isNotEmpty() || request.wsProtocol != null) add("Frames")
        }
        for ((i, label) in tabLabels.withIndex()) {
            val tv = tabTextView(label, i == currentTab)
            val idx = i
            tv.setOnClickListener {
                Haptics.light(this@DetailActivity)
                currentTab = idx; updateTabStyles(); rebuildTabContent()
            }
            tabViews.add(tv)
            addView(tv, LinearLayout.LayoutParams(0, WC, 1f).apply {
                setMargins(dp(GeneratedMetrics.Spacing.xs), 0, dp(GeneratedMetrics.Spacing.xs), 0)
            })
        }
    }

    private fun tabTextView(label: String, active: Boolean) = TextView(this).apply {
        text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
        setPadding(dp(Theme.s8), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
        addRipple(this@DetailActivity)
        applyTabStyle(this, active)
    }

    private fun applyTabStyle(tv: TextView, active: Boolean) {
        // Tabs: mono, uppercase, letterspaced; flame underline (2dp bottom stroke) for active.
        tv.background = if (active) {
            val bar = GradientDrawable().apply { setColor(Theme.accent(this@DetailActivity)) }
            android.graphics.drawable.LayerDrawable(arrayOf(bar)).apply {
                setLayerInset(0, dp(Theme.s4), 0, dp(Theme.s4), 0)
                setLayerHeight(0, dp(2))
                setLayerGravity(0, Gravity.BOTTOM)
            }
        } else null
        tv.setTextColor(if (active) Theme.accent(this) else Theme.tabInactive(this))
        tv.setTypeface(Typeface.MONOSPACE, if (active) Typeface.BOLD else Typeface.NORMAL)
        tv.isAllCaps = true
        tv.letterSpacing = 0.05f
    }

    private fun updateTabStyles() {
        for ((i, tv) in tabViews.withIndex()) applyTabStyle(tv, i == currentTab)
    }

    // ── Tab content ──────────────────────────────────────────────────────

    internal fun rebuildTabContent() {
        // Crossfade animation: fade out → rebuild → fade in
        contentLayout.animate().alpha(0f).setDuration(120).withEndAction {
            contentLayout.removeAllViews()
            // Tab indices are positional: Frames is appended after GraphQL (or after Timing
            // when there is no GraphQL).  Compute presence at render-time.
            val hasGraphQL = request.graphqlOperationName != null || isGraphQLRequest(request)
            val hasFrames = request.wsMessages.isNotEmpty() || request.wsProtocol != null
            when (currentTab) {
                0 -> buildOverviewTab()
                1 -> buildRequestTab()
                2 -> buildResponseTab()
                3 -> buildTimingTab()
                4 -> if (hasGraphQL) buildGraphQLTab() else if (hasFrames) buildFramesTab() else Unit
                5 -> if (hasFrames) buildFramesTab() else Unit
            }
            contentLayout.alpha = 0f
            contentLayout.animate().alpha(1f).setDuration(120).start()
        }.start()
    }

    internal fun dp(dp: Int): Int = dp(resources, dp)

    companion object {
        const val EXTRA_REQUEST_ID = "request_id"
    }
}
