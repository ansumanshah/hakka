package com.noodleapps.hakka.ui

import android.os.Bundle
import androidx.activity.ComponentActivity

/** Fullscreen Compose host for the Hakka inspector. Public activity identity is retained. */
class HakkaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val token = intent.getLongExtra(HakkaUI.FULLSCREEN_REQUEST_TOKEN, Long.MIN_VALUE)
            .takeUnless { it == Long.MIN_VALUE }
        try {
            if (!HakkaUI.getInstance(this).registerInspector(this, token)) {
                finish(); return
            }
            window.navigationBarColor = Theme.bg(this)
            applySystemStatusBar(window, this)
            setContent { HakkaInspectorCompose(this@HakkaActivity, ::finish) }
        } catch (_: Exception) {
            HakkaUI.getInstance(this).rejectInspector(token)
            finish()
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
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
}
