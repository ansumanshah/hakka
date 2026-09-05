package com.noodleapps.hakka.ui

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.activity.ComponentActivity
import com.noodleapps.hakka.NetworkRequest

/** Full-screen Compose detail screen for one captured Hakka request. */
class DetailActivity : ComponentActivity() {
    // Kept while old, unused detail extensions remain source-compatible.
    internal lateinit var contentLayout: LinearLayout
    internal lateinit var scrollView: ScrollView
    internal lateinit var request: NetworkRequest
    internal val searchHandler = Handler(Looper.getMainLooper())
    internal var pendingSearchRunnable: Runnable? = null
    internal var urlDecoded = true

    // Legacy detail helpers remain compiled for source compatibility while the
    // Compose screen owns rendering. They are no longer invoked by this activity.
    internal fun dp(value: Int): Int = dp(resources, value)
    internal fun rebuildTabContent() = Unit

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val captured = intent.getStringExtra(EXTRA_REQUEST_ID)
            ?.let { HakkaUI.getInstance(this).logStore?.get(it) }
        if (captured == null) { finish(); return }
        request = captured
        window.navigationBarColor = Theme.bg(this)
        applySystemStatusBar(window, this)
        setContent { HakkaDetailCompose(this@DetailActivity, captured, ::finish) }
    }
    companion object { const val EXTRA_REQUEST_ID = "request_id" }
}
