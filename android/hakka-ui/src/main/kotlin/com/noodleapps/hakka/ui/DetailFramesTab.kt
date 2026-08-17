package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

// ── Frames tab ───────────────────────────────────────────────────────

/**
 * Renders captured WebSocket frames (sent + received) in a timeline list,
 * mirroring the RN WsFramesTab.  Each row shows direction arrow, size, and
 * payload (truncated for large text; "binary data" label for binary frames).
 */
internal fun DetailActivity.buildFramesTab() {
    val c = contentLayout
    val frames = request.wsMessages

    request.wsProtocol?.let { proto ->
        addSectionHeader(c, "Protocol")
        addKV(c, "Sub-Protocol", proto)
        c.addView(divider(this))
    }

    if (frames.isEmpty()) {
        c.addView(grayText(this, "(no frames captured)", 12f).apply {
            setPadding(0, dp(Theme.s16), 0, dp(Theme.s16)); gravity = Gravity.CENTER
        })
        return
    }

    addSectionHeader(c, "Frames (${frames.size})")

    for (frame in frames) {
        val isSent = frame.sent
        val dirColor = if (isSent) Theme.info else Theme.success
        val dirIcon = if (isSent) R.drawable.hakka_ic_up else R.drawable.hakka_ic_down
        val dirLabel = if (isSent) "Sent" else "Received"

        val rowBg = GradientDrawable().apply {
            setColor(Theme.surface(this@buildFramesTab))
            cornerRadius = dp(Theme.radiusM).toFloat()
        }

        c.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rowBg
            setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
            layoutParams = LinearLayout.LayoutParams(MP, WC).apply {
                setMargins(0, 0, 0, dp(Theme.s4))
            }

            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                val badgeBg = GradientDrawable().apply {
                    setColor(dirColor); cornerRadius = dp(Theme.radiusS).toFloat()
                }
                addView(ImageView(context).apply {
                    setImageResource(dirIcon)
                    setColorFilter(Theme.badgeText)
                    background = badgeBg
                    val pad = dp(Theme.s4)
                    setPadding(pad, pad, pad, pad)
                    layoutParams = LinearLayout.LayoutParams(dp(18), dp(18)).apply {
                        setMargins(0, 0, dp(Theme.s6), 0)
                    }
                })
                addView(TextView(context).apply {
                    text = dirLabel; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
                    setTextColor(Theme.text(this@buildFramesTab))
                    layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                })
                addView(TextView(context).apply {
                    text = fmtSize(frame.size).ifEmpty { "0 B" }
                    textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTypeface(Typeface.MONOSPACE)
                    setTextColor(Theme.textSecondary(this@buildFramesTab))
                    setPadding(dp(Theme.s4), 0, 0, 0)
                })
                // Timestamp (relative to WS open, in ms)
                val relMs = frame.timestampMs - request.startTimeMs
                addView(monoText(context, "+${relMs}ms", 10f).apply {
                    setTextColor(Theme.textSecondary(this@buildFramesTab))
                    setPadding(dp(Theme.s6), 0, 0, 0)
                })
            })

            val payloadText: String = when {
                frame.binary && frame.data == null ->
                    "(binary ${fmtSize(frame.size)} — payload exceeds cap)"
                frame.binary ->
                    "(binary ${fmtSize(frame.size)}) ${frame.data ?: ""}"
                else -> {
                    val raw = frame.data ?: ""
                    if (raw.length > 300) raw.take(300) + "…" else raw
                }
            }
            addView(TextView(context).apply {
                text = payloadText; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                setTextColor(Theme.text(this@buildFramesTab))
                setPadding(0, dp(Theme.s4), 0, 0)
            })
        })
    }

    val sentCount = frames.count { it.sent }
    val recvCount = frames.size - sentCount
    c.addView(divider(this))
    c.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(0, dp(Theme.s4), 0, 0)
        addView(TextView(context).apply {
            text = "$sentCount sent"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.info)
            val icon = resources.getDrawable(R.drawable.hakka_ic_up, theme).apply { setBounds(0, 0, dp(11), dp(11)) }
            setCompoundDrawables(icon, null, null, null)
            compoundDrawablePadding = dp(Theme.s4)
            compoundDrawableTintList = android.content.res.ColorStateList.valueOf(Theme.info)
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
        addView(TextView(context).apply {
            text = "$recvCount received"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.success)
            val icon = resources.getDrawable(R.drawable.hakka_ic_down, theme).apply { setBounds(0, 0, dp(11), dp(11)) }
            setCompoundDrawables(icon, null, null, null)
            compoundDrawablePadding = dp(Theme.s4)
            compoundDrawableTintList = android.content.res.ColorStateList.valueOf(Theme.success)
        })
    })
}
