package com.noodleapps.hakka.ui

import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.noodleapps.hakka.export.CurlExporter
import com.noodleapps.hakka.export.OkHttpExporter
import com.noodleapps.hakka.export.PostmanExporter
import com.noodleapps.hakka.export.TextExporter

// ── Actions overflow menu ─────────────────────────────────────────────
// Custom-styled sheet (Wok Hei surface/text tokens, 44dp rows) — same pattern as
// HakkaActivity's tools menu — instead of a permanently docked action bar.

internal fun DetailActivity.showActionsMenu() {
    val actions = buildList {
        add("Copy cURL" to { clip("cURL", CurlExporter.export(request)) })
        add("Copy as OkHttp" to { clip("OkHttp code", OkHttpExporter.export(request)) })
        add("Copy URL" to { clip("URL", request.url) })
        add("Share" to {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"; putExtra(Intent.EXTRA_TEXT, TextExporter.export(request))
            }, "Share request"))
        })
        add("Export Postman" to {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_TEXT, PostmanExporter.export(listOf(request)))
                putExtra(Intent.EXTRA_SUBJECT, "Postman Collection")
            }, "Export Postman Collection"))
        })
        // QA loop-closer: freeze the captured response into an enabled mock rule.
        // Skipped when there's nothing to replay (no status AND no response body).
        if (request.status != null || request.responseBody != null) {
            add("Mock this" to { mockThis() })
        }
    }
    val dialog = Dialog(this, android.R.style.Theme_Translucent_NoTitleBar)
    val sheetBg = GradientDrawable().apply {
        setColor(Theme.surfaceRaised(this@showActionsMenu)); cornerRadius = dp(Theme.radiusL).toFloat()
    }
    val list = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = sheetBg
        setPadding(0, dp(Theme.s8), 0, dp(Theme.s8))
    }
    for ((index, action) in actions.withIndex()) {
        val (label, block) = action
        list.addView(TextView(this).apply {
            text = label; textSize = GeneratedMetrics.FontSize.lg.toFloat()
            setTextColor(Theme.text(this@showActionsMenu))
            gravity = Gravity.CENTER_VERTICAL
            minHeight = dp(44)
            setPadding(dp(Theme.s16), dp(Theme.s10), dp(Theme.s16), dp(Theme.s10))
            isClickable = true; isFocusable = true
            addRipple(this@showActionsMenu)
            setOnClickListener { dialog.dismiss(); block() }
        })
        if (index < actions.lastIndex) list.addView(divider(this))
    }
    val wrapper = FrameLayout(this).apply {
        setPadding(dp(Theme.s16), 0, dp(Theme.s16), 0)
        // Theme_Translucent_NoTitleBar gives a full-screen transparent window (needed
        // for HakkaBottomSheet's near-full-height presentation) — without an explicit
        // gravity the menu content defaults to top-left, landing under the status bar.
        // Center it like a normal action sheet instead.
        addView(list, FrameLayout.LayoutParams(MP, WC).apply { gravity = Gravity.CENTER })
    }
    dialog.setContentView(wrapper)
    dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    dialog.show()
}

private fun DetailActivity.mockThis() {
    val input = deriveMockRule(request) ?: return
    com.noodleapps.hakka.MockEngine.shared.addRule(input)
    Haptics.success(this)
    Toast.makeText(this, "Mock rule created for ${input.pattern}", Toast.LENGTH_SHORT).show()
}

private fun DetailActivity.clip(label: String, text: String) {
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    Toast.makeText(this, "$label copied", Toast.LENGTH_SHORT).show()
}
