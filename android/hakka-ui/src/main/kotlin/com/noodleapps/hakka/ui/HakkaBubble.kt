package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.noodleapps.hakka.HakkaPerformance
import com.noodleapps.hakka.LogStore
import com.noodleapps.hakka.SinkSubscription

/**
 * Floating draggable bubble overlay for Hakka.
 *
 * Three states, matching iOS/RN/web:
 * - **Collapsed** — the capsule (REQ/P95/FPS). Default.
 * - **Expanded** — tap the collapsed capsule to grow it in place into a compact HUD
 *   that additionally lists the most recent captured requests. Tap again to collapse.
 *   This never opens the inspector.
 * - **Inspector** — long-press (in either state) opens [HakkaBottomSheet] at its
 *   medium detent. See [bubbleTouchListener] for how long-press is kept from firing
 *   mid-drag.
 *
 * Drag repositions the bubble and drop-in-bottom-zone dismisses it, in both
 * collapsed and expanded state.
 *
 * Uses [WindowManager.addView] with [WindowManager.LayoutParams.TYPE_APPLICATION_PANEL]
 * so it floats above the activity without stealing focus.
 *
 * Split across files for cohesion — this file holds every stored property (Kotlin has
 * no partial classes, so state has to live in one file) plus the public API and
 * attach/detach lifecycle. Touch/drag/snap-to-edge is `HakkaBubbleTouch.kt`,
 * collapsed/expanded content building is `HakkaBubbleContent.kt`, and stats
 * refresh/render/perf-metrics is `HakkaBubbleRender.kt` — all as `internal`
 * extension functions on [HakkaBubble].
 */
class HakkaBubble private constructor() {

    internal var windowManager: WindowManager? = null
    internal var bubbleView: FrameLayout? = null
    internal var requestValueView: TextView? = null
    internal var requestCaptionView: TextView? = null
    internal var networkValueView: TextView? = null
    internal var networkCaptionView: TextView? = null
    internal var fpsValueView: TextView? = null
    internal var fpsCaptionView: TextView? = null
    internal var fpsDetailView: TextView? = null
    internal var recentRowsContainer: LinearLayout? = null
    internal var layoutParams: WindowManager.LayoutParams? = null
    internal var currentCount = 0
    internal var currentStats = BubbleStats()
    internal var currentFps: Double? = null
    internal var currentFrameStats = FrameMetricStats()
    internal var performance: HakkaPerformance? = null
    internal var performanceSubscription: SinkSubscription? = null
    // True when [performance] is the process-wide instance from `HakkaUI.sharedPerformance`
    // rather than one this bubble started itself — see [startPerformanceMetrics]. Mirrors
    // StatsTabController's identically-named field; governs who owns start()/close().
    internal var usesSharedPerformance = false
    internal var activity: Activity? = null
    internal var logStore: LogStore? = null
    internal var uiState = BubbleUiState.COLLAPSED
    internal var gestureDetector: GestureDetector? = null
    internal var touchSlopPx: Int = 0
    internal val mainHandler = Handler(Looper.getMainLooper())
    internal var statsRefreshScheduled = false
    internal val statsRefreshRunnable = Runnable {
        statsRefreshScheduled = false
        try {
            refreshNetworkStats()
            render()
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    // ── Constants ────────────────────────────────────────────────────────

    internal val BUBBLE_WIDTH_DP = 158
    internal val BUBBLE_HEIGHT_DP = 56
    internal val EXPANDED_WIDTH_DP = 240
    // Only used to keep the expanded HUD from being placed off the bottom edge —
    // WRAP_CONTENT drives the real (measured) height, this is just a clamp budget.
    internal val EXPANDED_HEIGHT_BUDGET_DP = 56 + 1 + (5 * 22) + 16
    internal val MAX_RECENT_ROWS = 5
    internal val EDGE_PADDING_DP = 8
    internal val HIDE_ZONE_DP = 80
    internal val SNAP_DURATION_MS = 250L
    internal val STATS_REFRESH_MS = 250L

    // Wok Hei tokens, fixed to the dark ground — this HUD floats over arbitrary host-app
    // content (any theme, any brightness) so it always renders as a dark glass capsule,
    // same rationale as iOS's BubbleWindow. Colors come from design-tokens.json via
    // GeneratedTokens — never raw hex outside generated token files (DESIGN.md).
    internal val COLOR_BG = withAlpha(Color.parseColor(GeneratedTokens.darkSurface), 217)
    internal val COLOR_BORDER = withAlpha(Color.parseColor(GeneratedTokens.darkBorder), 230)
    internal val COLOR_TEXT = Color.parseColor(GeneratedTokens.darkText)
    internal val COLOR_MUTED = Color.parseColor(GeneratedTokens.darkTextSecondary)
    internal val COLOR_IDLE = Color.parseColor(GeneratedTokens.darkTextTertiary)
    internal val COLOR_GOOD = Color.parseColor(GeneratedTokens.statusSuccess)
    internal val COLOR_WARN = Color.parseColor(GeneratedTokens.statusWarning)
    internal val COLOR_BAD = Color.parseColor(GeneratedTokens.statusError)

    // ── Public API ───────────────────────────────────────────────────────

    fun show(activity: Activity, logStore: LogStore?) {
        try {
            if (bubbleView != null) {
                if (this.activity === activity) return
                // Host Activity was destroyed/recreated since the last show() — the
                // stored window token is dead, so detach before reattaching instead
                // of getting permanently wedged on the stale Activity reference.
                removeBubble()
            }
            this.activity = activity
            this.logStore = logStore
            attach(activity)
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    fun hide() {
        try {
            removeBubble()
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    fun toggle(activity: Activity, logStore: LogStore?) {
        if (bubbleView != null) hide() else show(activity, logStore)
    }

    fun updateCount(count: Int) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { updateCount(count) }
            return
        }
        if (count == currentCount) return
        currentCount = count
        scheduleStatsRefresh()
    }

    // ── Build & attach ───────────────────────────────────────────────────

    private fun attach(activity: Activity) {
        val res = activity.resources
        val screenWidth = res.displayMetrics.widthPixels
        val screenHeight = res.displayMetrics.heightPixels
        val bubbleWidth = dp(res, BUBBLE_WIDTH_DP)
        val bubbleHeight = dp(res, BUBBLE_HEIGHT_DP)
        val edgePadding = dp(res, EDGE_PADDING_DP)

        windowManager = activity.windowManager
        touchSlopPx = ViewConfiguration.get(activity).scaledTouchSlop
        uiState = BubbleUiState.COLLAPSED
        gestureDetector = GestureDetector(activity, LongPressListener(activity))

        val bubble = FrameLayout(activity).apply {
            elevation = dp(res, 4).toFloat()
            isClickable = true
            isFocusable = true
        }
        bubbleView = bubble
        applyBubbleShape(activity)
        bubble.addView(buildCapsuleContent(activity), FrameLayout.LayoutParams(MP, MP))

        refreshNetworkStats()
        render()
        startPerformanceMetrics()

        // Layout params: application panel, not focusable, passes through outside touches
        val params = WindowManager.LayoutParams(
            bubbleWidth,
            bubbleHeight,
            WindowManager.LayoutParams.TYPE_APPLICATION_PANEL,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = screenWidth - bubbleWidth - edgePadding
            y = (screenHeight - bubbleHeight) / 2
            token = activity.window.decorView.windowToken
        }
        layoutParams = params

        bubble.setOnTouchListener(bubbleTouchListener(activity))
        installBubbleAccessibility(activity, bubble)

        windowManager?.addView(bubble, params)
    }

    internal fun removeBubble() {
        bubbleView?.let { view ->
            try { windowManager?.removeView(view) } catch (_: Exception) {}
        }
        bubbleView = null
        requestValueView = null
        requestCaptionView = null
        networkValueView = null
        networkCaptionView = null
        fpsValueView = null
        fpsCaptionView = null
        fpsDetailView = null
        recentRowsContainer = null
        layoutParams = null
        windowManager = null
        gestureDetector = null
        uiState = BubbleUiState.COLLAPSED
        stopPerformanceMetrics()
        activity = null
        logStore = null
    }

    // ── Touch state ──────────────────────────────────────────────────────
    // See HakkaBubbleTouch.kt's doc comment above `bubbleTouchListener` for the
    // drag-vs-long-press guarantee these properties are part of — LOAD-BEARING.

    internal var touchStartX = 0f
    internal var touchStartY = 0f
    internal var touchStartParamX = 0
    internal var touchStartParamY = 0
    internal var movedPastSlop = false
    internal var longPressFired = false

    internal inner class LongPressListener(private val activity: Activity) : GestureDetector.SimpleOnGestureListener() {
        override fun onLongPress(e: MotionEvent) {
            if (movedPastSlop) return // belt-and-suspenders — see class doc above
            longPressFired = true
            bubbleView?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            if (uiState == BubbleUiState.EXPANDED) setExpanded(activity, false)
            HakkaBottomSheet(activity, logStore).show()
        }
    }

    /** Pure member so both the class body and extension files can call it unqualified. */
    internal fun withAlpha(color: Int, alpha: Int): Int =
        Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))

    // ── Singleton ────────────────────────────────────────────────────────

    companion object {
        @Volatile
        private var instance: HakkaBubble? = null

        // @JvmStatic so reflective callers (hakka-react-native's NativeCoreDelegate
        // reaches this via Class.getMethod on the OUTER class) can resolve it.
        @JvmStatic
        fun getInstance(): HakkaBubble {
            return instance ?: synchronized(this) {
                instance ?: HakkaBubble().also { instance = it }
            }
        }
    }
}

/** The bubble's two visual states — top-level (not nested) so it resolves unqualified
 *  from the extension functions in the sibling `HakkaBubble*.kt` files too. */
internal enum class BubbleUiState { COLLAPSED, EXPANDED }

/**
 * True once cumulative movement from the initial touch-down exceeds the platform's
 * drag slop — the single gate that turns a long-press candidate into a drag (and a
 * tap candidate into neither). Pure math, no MotionEvent/Context, so the
 * long-press-vs-drag guarantee is testable without Robolectric.
 */
internal fun exceedsTouchSlop(dx: Float, dy: Float, slopPx: Int): Boolean =
    (dx * dx + dy * dy) > (slopPx.toFloat() * slopPx)
