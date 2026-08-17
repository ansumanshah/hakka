package com.noodleapps.hakka.ui

import android.view.View

/**
 * A single bottom-nav tab's content, owned by [HakkaActivity].
 *
 * hakka-ui never uses Fragments — every screen is a programmatic View tree built
 * by hand. Each tab is a small controller that builds its own [View] once
 * ([buildView]); [HakkaActivity] keeps that view instance alive for the app
 * session and just detaches/reattaches it on tab switches, so search text,
 * filter state, and scroll position all survive switching away and back.
 *
 * [onShow] / [onHide] fire on every tab switch AND forward from the host
 * Activity's onResume/onPause, so backgrounding the app while this tab is
 * active pauses its timers/subscriptions too. Implementations must be safe to
 * call [onShow] more than once in a row without leaking a subscription —
 * unsubscribe any previous one first.
 */
internal interface TabController {
    fun buildView(): View
    fun onShow() {}
    fun onHide() {}
}
