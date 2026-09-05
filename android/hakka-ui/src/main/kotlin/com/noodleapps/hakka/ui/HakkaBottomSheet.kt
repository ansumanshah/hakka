package com.noodleapps.hakka.ui

import android.animation.ValueAnimator
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.Window
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.noodleapps.hakka.LogStore

/**
 * Custom bottom sheet overlay — the compact presentation shell for the inspector.
 *
 * [HakkaActivity] is the other shell (full-screen, reached from the notification tap
 * and shake gesture, which can't rely on a WindowManager overlay surviving a backgrounded
 * app). Both shells host the exact same [TabController] instances/content — see
 * [controllers] below — so there is only ever one Network/Stats/Logs/Rules/Storage
 * implementation, not two drifting copies.
 *
 * Features:
 * - 60% height by default (the medium detent — iOS is being switched to match this
 *   custom 60% detent, not the other way round; UIKit's own `.medium()` is ~50%)
 * - Drag handle at top (32dp wide, 4dp tall rounded pill)
 * - Drag to expand to full screen / drag down to dismiss
 * - Rounded top corners (16dp radius)
 * - Scrim backdrop (semi-transparent)
 * - Slide-up entry / slide-down exit animation
 *
 * Usage:
 * ```kotlin
 * HakkaBottomSheet(activity, logStore).show()
 * ```
 */
class HakkaBottomSheet(
    private val activity: Activity,
    private val logStore: LogStore?,
) {
    private var dialog: Dialog? = null
    private var sheetView: FrameLayout? = null
    private var isDragging = false
    private var dragStartY = 0f
    private var dragStartHeight = 0
    // Real px/s fling velocity from VelocityTracker (not cumulative displacement) — see
    // [handleDrag]/[snapToDetent] and [snapTarget]'s doc comment for why displacement alone
    // is the wrong signal for "was this a fling".
    private var velocityTracker: VelocityTracker? = null

    // Sheet height states
    private val screenHeight: Int get() = activity.resources.displayMetrics.heightPixels
    private val mediumHeight: Int get() = (screenHeight * 0.6).toInt()
    private val largeHeight: Int get() = (screenHeight * 0.92).toInt()
    private var currentHeight: Int = 0

    // ── Tab-controller content ──────────────────────────────────────────────
    // Same controller instances/classes [HakkaActivity] hosts. Every TabController
    // only ever touches `activity` as a plain Context (resources, cacheDir,
    // startActivity, getSystemService…) — and this sheet always holds a genuine
    // Activity (see the constructor), same as HakkaActivity does — so the
    // controllers slot in here with zero adapter/abstraction needed.

    private val controllers: Map<NavTab, TabController> by lazy {
        mapOf(
            NavTab.NETWORK to NetworkTabController(
                activity,
                onOpenSettings = { activity.startActivity(Intent(activity, SettingsActivity::class.java)) },
                onCloseInspector = ::hide,
            ),
            NavTab.STATS to StatsTabController(activity),
            NavTab.LOGS to LogsTabController(activity),
            NavTab.RULES to RulesTabController(activity),
            NavTab.STORAGE to StorageTabController(activity),
        )
    }
    private val tabViews = mutableMapOf<NavTab, View>()
    private var currentTab: NavTab? = null
    private lateinit var panelContainer: FrameLayout
    private lateinit var tabBar: InspectorNavBar

    fun show() {
        try {
            if (dialog?.isShowing == true) return
            buildAndShow()
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    fun hide() {
        try { dismissWithAnimation() } catch (_: Exception) {}
    }

    internal fun isShowing(): Boolean = dialog?.isShowing == true

    fun toggle() {
        if (dialog?.isShowing == true) hide() else show()
    }

    private fun buildAndShow() {
        val ctx = activity
        currentHeight = mediumHeight

        dialog = Dialog(ctx, android.R.style.Theme_Translucent_NoTitleBar).apply {
            requestWindowFeature(Window.FEATURE_NO_TITLE)
            setCancelable(true)
            setCanceledOnTouchOutside(true)
            // Whichever tab is on screen when the sheet closes (drag-dismiss, scrim
            // tap, or back button) needs its onHide() forwarded — StatsTabController
            // in particular holds a live performance-metrics subscription that must
            // not outlive this short-lived sheet instance.
            setOnDismissListener { currentTab?.let { controllers.getValue(it).onHide() } }
        }

        // Root: scrim + sheet container
        val root = FrameLayout(ctx).apply {
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = FrameLayout.LayoutParams(MP, MP)
        }

        // Scrim (tap to dismiss)
        val scrim = View(ctx).apply {
            setBackgroundColor(Color.parseColor("#66000000"))
            alpha = 0f
            setOnClickListener { dismissWithAnimation() }
        }
        root.addView(scrim, FrameLayout.LayoutParams(MP, MP))

        // Sheet container (slides up from bottom)
        val sheetBg = GradientDrawable().apply {
            setColor(Theme.bg(ctx))
            cornerRadii = floatArrayOf(
                dp(ctx, 16f), dp(ctx, 16f), // top-left
                dp(ctx, 16f), dp(ctx, 16f), // top-right
                0f, 0f, 0f, 0f,              // bottom corners
            )
        }

        val sheet = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = sheetBg
            elevation = dp(ctx, 8f)
            clipToOutline = true
        }

        val handleContainer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(ctx, 8).toInt(), 0, dp(ctx, 4).toInt())
        }
        val handle = View(ctx).apply {
            val handleBg = GradientDrawable().apply {
                setColor(Theme.border(ctx))
                cornerRadius = dp(ctx, 2f)
            }
            background = handleBg
            layoutParams = LinearLayout.LayoutParams(dp(ctx, 32).toInt(), dp(ctx, 4).toInt())
        }
        handleContainer.addView(handle)
        sheet.addView(handleContainer)

        // Content: the same tab-controller content HakkaActivity hosts.
        val content = buildTabbedContent(ctx)
        sheet.addView(content, LinearLayout.LayoutParams(MP, 0, 1f))

        // Position sheet at bottom
        val sheetParams = FrameLayout.LayoutParams(MP, currentHeight).apply {
            gravity = Gravity.BOTTOM
        }
        sheetView = FrameLayout(ctx).apply {
            addView(sheet, FrameLayout.LayoutParams(MP, MP))
        }
        root.addView(sheetView, sheetParams)

        // Drag gesture on handle area
        handleContainer.setOnTouchListener(sheetDragListener())
        sheet.setOnTouchListener(sheetTopDragListener())

        dialog?.setContentView(root)
        dialog?.window?.apply {
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
            setBackgroundDrawableResource(android.R.color.transparent)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setDimAmount(0f) // We handle scrim ourselves
        }
        dialog?.show()

        // Slide-up entry animation
        sheetView?.translationY = currentHeight.toFloat()
        sheetView?.animate()
            ?.translationY(0f)
            ?.setDuration(250)
            ?.setInterpolator(DecelerateInterpolator())
            ?.start()
        scrim.animate().alpha(1f).setDuration(250).start()
    }

    /**
     * Bottom tab bar (Network / Stats / Logs / Rules / Storage) + a panel container
     * that swaps in whichever [TabController]'s view is selected — the sheet's
     * presentation of the exact same content [HakkaActivity]'s bottom nav
     * hosts. Each controller's view is built once and kept alive for the sheet's
     * lifetime (mirrors [HakkaActivity]'s tabViews cache), so switching tabs inside
     * one sheet session preserves scroll/filter state the same way.
     */
    private fun buildTabbedContent(ctx: Context): View {
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(ctx))
        }

        panelContainer = FrameLayout(ctx)
        root.addView(panelContainer, LinearLayout.LayoutParams(MP, 0, 1f))
        // The dialog extends behind gesture navigation, so reserve the same bottom
        // inset as fullscreen; otherwise the tab labels sit beneath the system bar.
        tabBar = InspectorNavBar(ctx, ::selectTab, navigationBarInsetPx(ctx.resources))
        root.addView(tabBar.view)

        selectTab(NavTab.NETWORK)
        return root
    }

    private fun selectTab(tab: NavTab) {
        if (!::panelContainer.isInitialized) return
        if (tab == currentTab) return
        currentTab?.let { controllers.getValue(it).onHide() }
        currentTab = tab
        tabBar.select(tab)
        val view = tabViews.getOrPut(tab) { controllers.getValue(tab).buildView() }
        panelContainer.removeAllViews()
        panelContainer.addView(view, FrameLayout.LayoutParams(MP, MP))
        controllers.getValue(tab).onShow()
    }

    private fun dismissWithAnimation() {
        val sheet = sheetView ?: return
        sheet.animate()
            .translationY(currentHeight.toFloat())
            .setDuration(200)
            .setInterpolator(DecelerateInterpolator())
            .withEndAction { dialog?.dismiss(); dialog = null; sheetView = null }
            .start()
    }

    // ── Drag handling ─────────────────────────────────────────────────────

    private fun sheetDragListener() = View.OnTouchListener { _, event ->
        handleDrag(event)
    }

    /** Only handle drag if touching the top 60dp of the sheet. */
    private fun sheetTopDragListener() = View.OnTouchListener { _, event ->
        if (event.y < dp(activity, 60f)) handleDrag(event) else false
    }

    private fun handleDrag(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                isDragging = true
                dragStartY = event.rawY
                dragStartHeight = currentHeight
                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain().apply { addMovement(event) }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!isDragging) return false
                velocityTracker?.addMovement(event)
                val dy = dragStartY - event.rawY
                val newHeight = (dragStartHeight + dy).toInt()
                    .coerceIn(dp(activity, 100).toInt(), largeHeight)
                currentHeight = newHeight
                sheetView?.layoutParams = (sheetView?.layoutParams as? FrameLayout.LayoutParams)?.apply {
                    height = newHeight
                }
                sheetView?.requestLayout()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                isDragging = false
                // px/s, positive = moving down the screen — computeCurrentVelocity's units
                // match ViewConfiguration.getScaledMinimumFlingVelocity()'s, both px/s.
                val tracker = velocityTracker
                tracker?.addMovement(event)
                tracker?.computeCurrentVelocity(1000)
                val velocityPxPerSec = tracker?.yVelocity ?: 0f
                tracker?.recycle()
                velocityTracker = null
                snapToDetent(velocityPxPerSec)
                return true
            }
        }
        return false
    }

    /** Snap to medium/large/dismiss based on position + real fling velocity. */
    private fun snapToDetent(velocityPxPerSec: Float) {
        val minFlingVelocityPxPerSec = ViewConfiguration.get(activity).scaledMinimumFlingVelocity.toFloat()
        val target = snapTarget(velocityPxPerSec, minFlingVelocityPxPerSec, currentHeight, mediumHeight, largeHeight)

        if (target == 0) {
            dismissWithAnimation()
            return
        }

        ValueAnimator.ofInt(currentHeight, target).apply {
            duration = 200
            interpolator = DecelerateInterpolator()
            addUpdateListener { v ->
                currentHeight = v.animatedValue as Int
                sheetView?.layoutParams = (sheetView?.layoutParams as? FrameLayout.LayoutParams)?.apply {
                    height = currentHeight
                }
                sheetView?.requestLayout()
            }
            start()
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun dp(ctx: Context, dp: Float): Float = dp * ctx.resources.displayMetrics.density
    private fun dp(ctx: Context, dp: Int): Float = dp * ctx.resources.displayMetrics.density
}

/**
 * Pure decision half of [HakkaBottomSheet.snapToDetent]: given a real fling velocity (px/s,
 * positive = downward, from [VelocityTracker.getYVelocity] — NOT cumulative drag displacement,
 * which is time-independent and fires just as readily on a slow deliberate drag as on a fast
 * fling) plus the sheet's current/medium/large heights, returns the target height to animate
 * to, or 0 to dismiss. Kept pure (no Android view/motion-event types) so it's testable without
 * Robolectric, like [exceedsTouchSlop].
 */
internal fun snapTarget(
    velocityPxPerSec: Float,
    minFlingVelocityPxPerSec: Float,
    currentHeight: Int,
    mediumHeight: Int,
    largeHeight: Int,
): Int = when {
    // Fast downward fling → dismiss
    velocityPxPerSec > minFlingVelocityPxPerSec && currentHeight < mediumHeight -> 0
    // Below 30% of medium → dismiss
    currentHeight < mediumHeight * 0.3 -> 0
    // Above 75% of large → snap to large
    currentHeight > largeHeight * 0.75 -> largeHeight
    // Otherwise snap to medium
    else -> mediumHeight
}
