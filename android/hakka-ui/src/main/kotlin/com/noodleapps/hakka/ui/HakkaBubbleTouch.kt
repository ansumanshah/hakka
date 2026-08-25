package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.res.Resources
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.animation.ValueAnimator
import androidx.core.view.ViewCompat

// ── Touch handling ───────────────────────────────────────────────────
//
// Drag and long-press share a gesture prefix (finger down, then either holds
// still or moves), so a naive setOnLongClickListener would fire mid-drag.
// Guarantee: `movedPastSlop` latches true the moment cumulative movement from
// ACTION_DOWN exceeds `touchSlopPx` (ViewConfiguration's scaledTouchSlop) and
// never resets until the next ACTION_DOWN. From that point on:
//   - the gesture is treated purely as a drag (position updates every MOVE)
//   - LongPressListener.onLongPress re-checks `movedPastSlop` itself and no-ops
//     if it's true, even though GestureDetector already cancels its own pending
//     long-press timer once it sees a move past its internal (same) touch slop
//   - ACTION_UP's tap branch (`toggleExpanded`) is gated on `!movedPastSlop`
// So repositioning the bubble can never open the sheet: both paths that open it
// (the tap branch is not one — see below) require `movedPastSlop == false`.

internal fun HakkaBubble.bubbleTouchListener(activity: Activity) = View.OnTouchListener { _, event ->
    val params = layoutParams ?: return@OnTouchListener false
    val wm = windowManager ?: return@OnTouchListener false
    val view = bubbleView ?: return@OnTouchListener false

    gestureDetector?.onTouchEvent(event)

    when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
            touchStartX = event.rawX
            touchStartY = event.rawY
            touchStartParamX = params.x
            touchStartParamY = params.y
            movedPastSlop = false
            longPressFired = false
            true
        }

        MotionEvent.ACTION_MOVE -> {
            if (longPressFired) return@OnTouchListener true
            val dx = event.rawX - touchStartX
            val dy = event.rawY - touchStartY
            if (!movedPastSlop && exceedsTouchSlop(dx, dy, touchSlopPx)) {
                movedPastSlop = true
            }
            if (movedPastSlop) {
                params.x = touchStartParamX + dx.toInt()
                params.y = touchStartParamY + dy.toInt()
                try { wm.updateViewLayout(view, params) } catch (_: Exception) {}
            }
            true
        }

        MotionEvent.ACTION_UP -> {
            if (longPressFired) {
                longPressFired = false
                return@OnTouchListener true
            }
            if (movedPastSlop) {
                if (isInHideZone(activity, params.y)) {
                    animateHide(view)
                } else {
                    snapToEdge(activity, view, params)
                }
            } else {
                // Tap -> expand/collapse the inline HUD in place. Routed through
                // performClick() (handled by the OnClickListener set in attach())
                // rather than calling setExpanded() directly, so a TalkBack/Voice
                // Access synthesized ACTION_CLICK reaches the same code path.
                // No elapsed-time gate: drag is already ruled out (`!movedPastSlop`
                // above) and long-press already returned early, so any release that
                // reaches here is a tap no matter how long it was held — a fixed
                // tap-timeout window here would otherwise leave a dead zone between
                // it and GestureDetector's own (longer, system) long-press timeout.
                view.performClick()
            }
            true
        }

        MotionEvent.ACTION_CANCEL -> {
            longPressFired = false
            true
        }

        else -> false
    }
}

// ── Accessibility ────────────────────────────────────────────────────
//
// The touch handling above is a raw OnTouchListener, so TalkBack/Voice Access
// get nothing for free: a synthesized ACTION_CLICK only reaches
// view.performClick() (called from the tap branch above) because we register
// an OnClickListener here — same tap -> expand/collapse behavior as the touch
// path. Long-press (open inspector) and drag-into-hide-zone (dismiss) have no
// click equivalent, so they're exposed as custom accessibility actions via
// ViewCompat.addAccessibilityAction — NOT a hand-rolled AccessibilityDelegate keyed
// by View.generateViewId(). generateViewId() hands out small sequential integers
// (1, 2, 3, ...) starting fresh each process, which collide with
// AccessibilityNodeInfo's standard legacy action ints occupying that exact low
// range (ACTION_FOCUS=1, ACTION_CLEAR_FOCUS=2, ACTION_CLICK=16, ...). ViewCompat
// allocates custom-action IDs from a reserved high range (0x3f000000+) instead, so
// they can never shadow a standard action.

internal fun HakkaBubble.installBubbleAccessibility(activity: Activity, view: View) {
    view.setOnClickListener {
        Haptics.light(activity)
        setExpanded(activity, uiState == BubbleUiState.COLLAPSED)
    }
    ViewCompat.addAccessibilityAction(view, "Open inspector") { _, _ ->
        if (uiState == BubbleUiState.EXPANDED) setExpanded(activity, false)
        HakkaBottomSheet(activity, logStore).show()
        true
    }
    ViewCompat.addAccessibilityAction(view, "Dismiss") { _, _ ->
        hide()
        true
    }
}

// ── Snap to edge ─────────────────────────────────────────────────────

internal fun HakkaBubble.snapToEdge(activity: Activity, view: View, params: WindowManager.LayoutParams) {
    val res = activity.resources
    val screenWidth = res.displayMetrics.widthPixels
    val screenHeight = res.displayMetrics.heightPixels
    val bubbleWidth = params.width
    val bubbleHeight = heightEstimate(res)
    val edgePadding = dp(res, EDGE_PADDING_DP)
    val wm = windowManager ?: return

    // Determine nearest edge (left or right)
    val centerX = params.x + bubbleWidth / 2
    val targetX = if (centerX < screenWidth / 2) {
        edgePadding
    } else {
        screenWidth - bubbleWidth - edgePadding
    }

    // Clamp Y: status bar + 10dp top, nav bar + 10dp bottom
    val statusBarHeight = getStatusBarHeight(res)
    val navBarHeight = getNavBarHeight(res)
    val minY = statusBarHeight + dp(res, 10)
    val maxY = screenHeight - navBarHeight - bubbleHeight - dp(res, 10)
    val clampedY = params.y.coerceIn(minY, maxY)

    ValueAnimator.ofInt(params.x, targetX).apply {
        duration = SNAP_DURATION_MS
        interpolator = DecelerateInterpolator()
        addUpdateListener { animator ->
            params.x = animator.animatedValue as Int
            params.y = clampedY
            try { wm.updateViewLayout(view, params) } catch (_: Exception) {}
        }
        start()
    }
}

// ── Hide zone ────────────────────────────────────────────────────────

internal fun HakkaBubble.isInHideZone(activity: Activity, y: Int): Boolean {
    val res = activity.resources
    val screenHeight = res.displayMetrics.heightPixels
    val hideZone = dp(res, HIDE_ZONE_DP)
    return (y + heightEstimate(res)) > (screenHeight - hideZone)
}

internal fun HakkaBubble.animateHide(view: View) {
    view.animate()
        .translationY(dp(view.resources, 100).toFloat())
        .alpha(0f)
        .setDuration(200)
        .setInterpolator(DecelerateInterpolator())
        .withEndAction { removeBubble() }
        .start()
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Height budget for hide-zone/edge-snap math. `layoutParams.height` is
 *  WRAP_CONTENT (a negative sentinel) while expanded, so this uses the fixed
 *  per-state budget instead of trusting the live (possibly negative) params. */
internal fun HakkaBubble.heightEstimate(res: Resources): Int =
    if (uiState == BubbleUiState.EXPANDED) dp(res, EXPANDED_HEIGHT_BUDGET_DP) else dp(res, BUBBLE_HEIGHT_DP)

internal fun HakkaBubble.getStatusBarHeight(res: Resources): Int {
    val id = res.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) res.getDimensionPixelSize(id) else dp(res, 24)
}

internal fun HakkaBubble.getNavBarHeight(res: Resources): Int {
    val id = res.getIdentifier("navigation_bar_height", "dimen", "android")
    return if (id > 0) res.getDimensionPixelSize(id) else dp(res, 48)
}
