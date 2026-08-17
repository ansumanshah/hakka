package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.SpannableString
import android.text.TextWatcher
import android.text.style.BackgroundColorSpan
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.noodleapps.hakka.bodyDecoders

// ── Detail tab body viewer ───────────────────────────────────────────────
// Shared JSON-tree/raw body renderer with search — used by the Request,
// Response, and GraphQL tabs, all of which display a decoded request/response
// payload the same way.

/**
 * Renders [rawBody], first running it through [bodyDecoders] (gated on [contentType] /
 * [contentEncoding] exactly like core's decoder pipeline) so gzip/deflate/SSE/protobuf/
 * gRPC-web bodies render decoded instead of raw/garbled bytes. Falls back to [rawBody]
 * unchanged when no decoder matches (the built-in passthrough).
 */
internal fun DetailActivity.buildBodyContent(
    parent: LinearLayout,
    rawBody: String,
    contentType: String? = null,
    contentEncoding: String? = null,
) {
    val body = bodyDecoders.decode(rawBody, contentType, contentEncoding)
    val isJson = isJsonString(body)
    val bodyContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    // --- Mutable search state for this body instance ---
    // matchStarts holds the character-offset of every match in [body].
    // currentMatchIdx is the zero-based focused match (-1 = none).
    // queryLen tracks the length of the active query for span colouring.
    val matchStarts = mutableListOf<Int>()
    var currentMatchIdx = -1
    var queryLen = 0

    val matchCountLabel = TextView(this).apply {
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(this@buildBodyContent))
        setPadding(dp(Theme.s4), 0, dp(Theme.s4), 0); visibility = View.GONE
    }
    val rawBg = GradientDrawable().apply {
        setColor(Theme.surface(this@buildBodyContent)); cornerRadius = dp(Theme.radiusM).toFloat()
    }
    val rawTextView = TextView(this).apply {
        text = body; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.text(this@buildBodyContent))
        setTypeface(Typeface.MONOSPACE); background = rawBg
        setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
    }

    var treeView: JsonTreeView? = null
    var showingTree = isJson
    if (isJson) { treeView = JsonTreeView(this).apply { setJson(body) } }

    val toggleBtn = if (isJson) TextView(this).apply {
        text = "Raw"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.accent(this@buildBodyContent))
        setPadding(dp(Theme.s4), dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s4), dp(Theme.s4))
        setOnClickListener {
            showingTree = !showingTree
            text = if (showingTree) "Raw" else "Tree"
            rawTextView.visibility = if (showingTree) View.GONE else View.VISIBLE
            treeView?.visibility = if (showingTree) View.VISIBLE else View.GONE
        }
    } else null

    // Helper: re-render highlights + count label, then scroll to focused match.
    fun renderAndScroll() {
        applySearchHighlightWithFocus(rawTextView, body, matchStarts, currentMatchIdx, queryLen, matchCountLabel)
        scrollToMatch(rawTextView, matchStarts, currentMatchIdx)
    }

    // --- Nav row: "‹ X/N ›" — hidden until there are ≥ 1 matches ---
    val prevBtn = buildNavArrow("‹") {
        if (matchStarts.size > 1) {
            currentMatchIdx = (currentMatchIdx - 1 + matchStarts.size) % matchStarts.size
            renderAndScroll()
        }
    }
    val nextBtn = buildNavArrow("›") {
        if (matchStarts.size > 1) {
            currentMatchIdx = (currentMatchIdx + 1) % matchStarts.size
            renderAndScroll()
        }
    }
    val navRow = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        visibility = View.GONE
        setPadding(0, 0, 0, dp(Theme.s4))
        addView(prevBtn)
        addView(matchCountLabel)
        addView(nextBtn)
    }

    val searchBg = GradientDrawable().apply {
        setColor(Theme.surface(this@buildBodyContent)); cornerRadius = dp(Theme.radiusM).toFloat()
    }
    val searchBar = EditText(this).apply {
        hint = "Search body…"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setSingleLine()
        setTextColor(Theme.text(this@buildBodyContent))
        setHintTextColor(Theme.textSecondary(this@buildBodyContent))
        background = searchBg
        setPadding(dp(Theme.s8), dp(Theme.s4), dp(Theme.s8), dp(Theme.s4))
        layoutParams = LinearLayout.LayoutParams(MP, WC).apply {
            setMargins(0, 0, 0, dp(Theme.s4))
        }
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                // Debounce search to avoid jank on large bodies
                pendingSearchRunnable?.let { searchHandler.removeCallbacks(it) }
                pendingSearchRunnable = Runnable {
                    val query = s?.toString()?.trim().orEmpty()
                    matchStarts.clear()
                    queryLen = query.length
                    if (query.isNotEmpty()) {
                        val lowerBody = body.lowercase()
                        val lowerQuery = query.lowercase()
                        var pos = 0
                        while (true) {
                            val idx = lowerBody.indexOf(lowerQuery, pos)
                            if (idx < 0) break
                            matchStarts.add(idx)
                            pos = idx + 1
                        }
                    }
                    currentMatchIdx = if (matchStarts.isNotEmpty()) 0 else -1
                    navRow.visibility = if (matchStarts.isNotEmpty()) View.VISIBLE else View.GONE
                    prevBtn.isEnabled = matchStarts.size > 1
                    nextBtn.isEnabled = matchStarts.size > 1
                    renderAndScroll()
                    treeView?.setSearchQuery(query)
                }
                searchHandler.postDelayed(pendingSearchRunnable!!, 200)
            }
        })
    }
    bodyContainer.addView(searchBar)
    bodyContainer.addView(navRow)
    if (toggleBtn != null) bodyContainer.addView(toggleBtn)
    if (treeView != null) { bodyContainer.addView(treeView); rawTextView.visibility = View.GONE }
    bodyContainer.addView(rawTextView)
    parent.addView(bodyContainer)
}

/**
 * Renders search highlights on [tv]: focused match uses [Theme.searchHighlightActive],
 * all other matches use [Theme.searchHighlight]. Updates [countLabel] to "current/total".
 */
private fun DetailActivity.applySearchHighlightWithFocus(
    tv: TextView,
    body: String,
    matchStarts: List<Int>,
    focusIdx: Int,
    queryLen: Int,
    countLabel: TextView,
) {
    if (matchStarts.isEmpty() || queryLen == 0) {
        tv.text = body
        countLabel.visibility = View.GONE
        return
    }
    val spannable = SpannableString(body)
    val dimColor = Theme.searchHighlight(this)
    val focusColor = Theme.searchHighlightActive(this)
    for ((i, start) in matchStarts.withIndex()) {
        val end = (start + queryLen).coerceAtMost(body.length)
        val color = if (i == focusIdx) focusColor else dimColor
        spannable.setSpan(BackgroundColorSpan(color), start, end,
            SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    tv.text = spannable
    val total = matchStarts.size
    countLabel.text = if (focusIdx >= 0) "${focusIdx + 1}/$total" else total.toString()
    countLabel.visibility = View.VISIBLE
}

/** Builds a small "‹" or "›" navigation arrow button for body search. */
private fun DetailActivity.buildNavArrow(label: String, onClick: () -> Unit): TextView {
    return TextView(this).apply {
        text = label; textSize = GeneratedMetrics.FontSize.xxl.toFloat(); gravity = Gravity.CENTER
        setTextColor(Theme.accent(this@buildNavArrow))
        setPadding(dp(Theme.s8), dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s8), dp(GeneratedMetrics.Spacing.xxs))
        isClickable = true; isFocusable = true
        addRipple(this@buildNavArrow)
        setOnClickListener { Haptics.light(this@buildNavArrow); onClick() }
    }
}

/**
 * Scrolls the outer [DetailActivity.scrollView] so the match at [idx] in [matchStarts]
 * is visible. Uses [TextView.getLayout] for accurate character-to-pixel line mapping.
 */
private fun DetailActivity.scrollToMatch(tv: TextView, matchStarts: List<Int>, idx: Int) {
    if (idx < 0 || idx >= matchStarts.size) return
    tv.post {
        val layout = tv.layout ?: return@post
        val charOffset = matchStarts[idx]
        val line = layout.getLineForOffset(charOffset)
        val lineTop = layout.getLineTop(line)
        // Walk up the view tree to find the absolute Y of tv relative to scrollView.
        var offsetY = tv.top
        var view: View = tv
        while (true) {
            val p = view.parent as? View ?: break
            if (p === scrollView) break
            offsetY += p.top
            view = p
        }
        val targetY = (offsetY + lineTop - dp(48)).coerceAtLeast(0)
        scrollView.smoothScrollTo(0, targetY)
    }
}

private fun isJsonString(s: String): Boolean {
    val t = s.trim()
    return t.isNotEmpty() && ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]")))
}
