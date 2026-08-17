package com.noodleapps.hakka.ui

import android.graphics.BitmapFactory
import android.util.Base64
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import com.noodleapps.hakka.parseSetCookie

// ── Response tab ─────────────────────────────────────────────────────

internal fun DetailActivity.buildResponseTab() {
    val c = contentLayout
    if (isImageContentType(request.responseHeaders) && request.responseBody != null) {
        addSectionHeader(c, "Image Preview")
        buildImagePreview(c, request.responseBody!!)
        c.addView(divider(this))
    }

    // Set-Cookie headers: collect all values and parse for structured display
    val setCookieValues = getMultiHeaderValues(request.responseHeaders, "set-cookie")
    val setCookies = parseSetCookie(setCookieValues)
    if (setCookies.isNotEmpty()) {
        addSectionHeader(c, "Set-Cookie (${setCookies.size})")
        buildSetCookiesTable(c, setCookies)
        c.addView(divider(this))
    }

    if (request.responseBody != null) {
        addSectionHeader(c, "Body")
        buildBodyContent(
            c,
            request.responseBody!!,
            headerValue(request.responseHeaders, "content-type"),
            headerValue(request.responseHeaders, "content-encoding"),
        )
    } else if (setCookies.isEmpty()) {
        c.addView(grayText(this, "(no response body)", 12f).apply {
            setPadding(0, dp(Theme.s16), 0, dp(Theme.s16)); gravity = Gravity.CENTER
        })
    }
}

private fun DetailActivity.isImageContentType(headers: Map<String, List<String>>): Boolean {
    return headers.entries.any { (k, vs) ->
        k.equals("content-type", ignoreCase = true) &&
            vs.any { it.startsWith("image/", ignoreCase = true) }
    }
}

private fun DetailActivity.buildImagePreview(parent: LinearLayout, body: String) {
    // Guard: skip decode if body is too large (>2MB base64 ≈ 1.5MB decoded)
    if (body.length > 2 * 1024 * 1024) {
        parent.addView(grayText(this, "(image too large to preview)", 11f))
        return
    }
    val placeholder = grayText(this, "Loading image…", 11f)
    parent.addView(placeholder)
    // Decode off main thread to prevent ANR
    Thread {
        try {
            val bytes = Base64.decode(body, Base64.DEFAULT)
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            runOnUiThread {
                parent.removeView(placeholder)
                if (bmp != null) {
                    parent.addView(ImageView(this).apply {
                        setImageBitmap(bmp); adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER
                        layoutParams = LinearLayout.LayoutParams(MP, WC).apply {
                            topMargin = dp(Theme.s4); bottomMargin = dp(Theme.s4)
                        }
                        maxHeight = dp(400)
                        setBackgroundColor(Theme.surface(this@buildImagePreview))
                    })
                } else {
                    parent.addView(grayText(this, "(unable to decode image)", 11f))
                }
            }
        } catch (_: Exception) {
            runOnUiThread {
                parent.removeView(placeholder)
                parent.addView(grayText(this, "(unable to decode image)", 11f))
            }
        }
    }.start()
}
