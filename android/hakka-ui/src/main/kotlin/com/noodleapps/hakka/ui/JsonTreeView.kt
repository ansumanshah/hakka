package com.noodleapps.hakka.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject

/**
 * Collapsible JSON tree viewer.
 *
 * Features:
 * - Syntax colors: keys=bold label, strings=red, numbers=blue, bools/null=pink, punctuation=muted
 * - Indent guides: faint vertical lines per nesting level
 * - Collapsible nodes with chevron indicators
 * - Long-press to copy values
 * - Quoted keys: "key": "value" with trailing commas
 * - Collapsed format: ▸ "key": { … } (3)
 * - String truncation at 80 chars
 */
class JsonTreeView(context: Context) : LinearLayout(context) {

    private var parsed: Any? = null
    private var searchQuery: String = ""
    private val collapsed = mutableSetOf<String>()
    private val maxStringLength = 80

    init {
        orientation = VERTICAL
    }

    fun setJson(jsonString: String) {
        parsed = try {
            val trimmed = jsonString.trim()
            if (trimmed.startsWith("[")) JSONArray(trimmed) else JSONObject(trimmed)
        } catch (_: Exception) { null }
        collapsed.clear()
        rebuild()
    }

    fun setSearchQuery(query: String) {
        searchQuery = query.trim()
        rebuild()
    }

    private fun rebuild() {
        removeAllViews()
        val root = parsed ?: return
        renderValue(this, null, root, 0, "root", isLast = true)
    }

    // ── Render ────────────────────────────────────────────────────────────

    private fun renderValue(parent: LinearLayout, key: String?, value: Any?, depth: Int, path: String, isLast: Boolean) {
        when (value) {
            is JSONObject -> renderContainer(parent, key, value, depth, path, isLast)
            is JSONArray -> renderContainer(parent, key, value, depth, path, isLast)
            else -> parent.addView(leafRow(key, value, depth, isLast))
        }
    }

    private fun renderContainer(parent: LinearLayout, key: String?, container: Any, depth: Int, path: String, isLast: Boolean) {
        val isObj = container is JSONObject
        val count = if (isObj) (container as JSONObject).length() else (container as JSONArray).length()
        val open = if (isObj) "{" else "["
        val close = if (isObj) "}" else "]"
        val comma = if (isLast) "" else ","
        val isClosed = path in collapsed

        // Empty container — single line
        if (count == 0) {
            parent.addView(leafTextRow("$open$close$comma", Theme.jsonPunctuation(context), depth))
            return
        }

        // Header row (with chevron)
        val headerRow = IndentedRow(context, depth).apply {
            val tv = TextView(context).apply {
                textSize = GeneratedMetrics.FontSize.sm.toFloat()
                setTypeface(Typeface.MONOSPACE)
                letterSpacing = -0.02f
                text = buildHeaderSpan(key, open, close, count, isClosed, comma)
                setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
            }
            addView(tv)
            isClickable = true
            isFocusable = true
            setOnClickListener {
                if (path in collapsed) collapsed.remove(path) else collapsed.add(path)
                rebuild()
            }
        }
        parent.addView(headerRow)

        if (!isClosed) {
            if (isObj) {
                val obj = container as JSONObject
                val keys = obj.keys().asSequence().toList()
                for ((i, childKey) in keys.withIndex()) {
                    val childPath = "$path.$childKey"
                    renderValue(parent, childKey, obj.opt(childKey), depth + 1, childPath, i == keys.lastIndex)
                }
            } else {
                val arr = container as JSONArray
                for (i in 0 until arr.length()) {
                    val childPath = "$path[$i]"
                    renderValue(parent, "[$i]", arr.opt(i), depth + 1, childPath, i == arr.length() - 1)
                }
            }
            parent.addView(IndentedRow(context, depth).apply {
                addView(TextView(context).apply {
                    textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE); letterSpacing = -0.02f
                    setTextColor(Theme.jsonPunctuation(context))
                    text = "$close$comma"
                    setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
                })
            })
        }
    }

    private fun buildHeaderSpan(key: String?, open: String, close: String, count: Int, isClosed: Boolean, comma: String): CharSequence {
        val sb = SpannableStringBuilder()
        val chevron = if (isClosed) "\u25B8 " else "\u25BE "
        sb.appendColored(chevron, Theme.textSecondary(context))
        if (key != null && !key.startsWith("[")) {
            sb.appendKey("\"$key\"")
            sb.appendColored(": ", Theme.jsonPunctuation(context))
        } else if (key != null) {
            sb.appendColored("$key: ", Theme.jsonPunctuation(context))
        }
        if (isClosed) {
            sb.appendColored("$open \u2026 $close ($count)$comma", Theme.jsonPunctuation(context))
        } else {
            sb.appendColored(open, Theme.jsonPunctuation(context))
        }
        return sb
    }

    // ── Leaf rows ──────────────────────────────────────────────────────────

    private fun leafRow(key: String?, value: Any?, depth: Int, isLast: Boolean): View {
        val comma = if (isLast) "" else ","
        val (displayText, color, copyValue) = valueDisplay(value)

        val sb = SpannableStringBuilder()
        if (key != null && !key.startsWith("[")) {
            sb.appendKey("\"$key\"")
            sb.appendColored(": ", Theme.jsonPunctuation(context))
        } else if (key != null) {
            sb.appendColored("$key: ", Theme.jsonPunctuation(context))
        }

        val valueStart = sb.length
        sb.append(displayText)
        sb.setSpan(ForegroundColorSpan(color), valueStart, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)

        if (comma.isNotEmpty()) {
            sb.appendColored(comma, Theme.jsonPunctuation(context))
        }

        if (searchQuery.isNotEmpty()) {
            applySearchHighlightSpans(sb)
        }

        return IndentedRow(context, depth).apply {
            val tv = TextView(context).apply {
                textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE); letterSpacing = -0.02f
                text = sb
                setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
            }
            addView(tv)
            if (copyValue != null) {
                setOnLongClickListener {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return@setOnLongClickListener true
                    clipboard.setPrimaryClip(ClipData.newPlainText("JSON value", copyValue))
                    Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
                    true
                }
            }
        }
    }

    private fun leafTextRow(text: String, color: Int, depth: Int): View {
        return IndentedRow(context, depth).apply {
            addView(TextView(context).apply {
                textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE); letterSpacing = -0.02f
                setTextColor(color)
                this.text = text
                setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
            })
        }
    }

    // ── Value display ────────────────────────────────────────────────────

    private data class ValueInfo(val display: String, val color: Int, val copyValue: String?)

    private fun valueDisplay(value: Any?): ValueInfo = when {
        value == null || value == JSONObject.NULL ->
            ValueInfo("null", Theme.jsonNull(context), "null")
        value is String -> {
            val truncated = if (value.length > maxStringLength)
                value.substring(0, maxStringLength) + "\u2026" else value
            ValueInfo("\"$truncated\"", Theme.jsonString(context), value)
        }
        value is Number ->
            ValueInfo(value.toString(), Theme.jsonNumber(context), value.toString())
        value is Boolean ->
            ValueInfo(value.toString(), Theme.jsonBool(context), value.toString())
        else ->
            ValueInfo(value.toString(), Theme.text(context), value.toString())
    }

    // ── SpannableStringBuilder helpers ────────────────────────────────────

    private fun SpannableStringBuilder.appendColored(text: String, color: Int) {
        val start = length
        append(text)
        setSpan(ForegroundColorSpan(color), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    private fun SpannableStringBuilder.appendKey(text: String) {
        val start = length
        append(text)
        setSpan(ForegroundColorSpan(Theme.jsonKey(context)), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        setSpan(StyleSpan(Typeface.BOLD), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    private fun applySearchHighlightSpans(sb: SpannableStringBuilder) {
        val text = sb.toString().lowercase()
        val query = searchQuery.lowercase()
        var start = 0
        val highlight = Theme.searchHighlight(context)
        while (true) {
            val idx = text.indexOf(query, start)
            if (idx < 0) break
            sb.setSpan(BackgroundColorSpan(highlight), idx, idx + searchQuery.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            start = idx + 1
        }
    }

    // ── IndentedRow with indent guides ───────────────────────────────────

    /**
     * A horizontal LinearLayout that draws faint vertical indent guide lines.
     * Each guide is drawn at (indentWidth * level) from the left.
     */
    private inner class IndentedRow(ctx: Context, private val depth: Int) : LinearLayout(ctx) {
        private val indentWidthPx = dp(14)
        private val guidePaint = Paint().apply {
            color = Theme.border(ctx)
            strokeWidth = dp(1).toFloat()
            isAntiAlias = true
        }

        init {
            orientation = HORIZONTAL
            setPadding(indentWidthPx * depth + dp(Theme.s4), 0, 0, 0)
        }

        override fun dispatchDraw(canvas: Canvas) {
            // Draw indent guide lines
            for (level in 1..depth) {
                val x = (indentWidthPx * level - indentWidthPx / 2).toFloat()
                canvas.drawLine(x, 0f, x, height.toFloat(), guidePaint)
            }
            super.dispatchDraw(canvas)
        }
    }

    private fun dp(dp: Int): Int = dp(resources, dp)
}
