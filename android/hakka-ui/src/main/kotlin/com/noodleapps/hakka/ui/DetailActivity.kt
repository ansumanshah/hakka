package com.noodleapps.hakka.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent

/** Full-screen Compose detail screen for one captured Hakka request. */
class DetailActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val captured = intent.getStringExtra(EXTRA_REQUEST_ID)
            ?.let { HakkaUI.getInstance(this).logStore?.get(it) }
        if (captured == null) { finish(); return }
        window.navigationBarColor = Theme.bg(this)
        applySystemStatusBar(window, this)
        setContent { HakkaDetailCompose(this@DetailActivity, captured, ::finish) }
    }
    companion object { const val EXTRA_REQUEST_ID = "request_id" }
}
