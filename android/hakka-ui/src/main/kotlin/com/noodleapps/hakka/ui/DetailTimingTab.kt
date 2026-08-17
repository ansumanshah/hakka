package com.noodleapps.hakka.ui

import android.animation.ValueAnimator
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.LinearLayout
import android.widget.TextView

// ── Timing tab ───────────────────────────────────────────────────────

internal fun DetailActivity.buildTimingTab() {
    val c = contentLayout
    val hasTimingData = listOfNotNull(
        request.dnsMs, request.connectMs, request.tlsMs, request.ttfbMs, request.downloadMs
    ).isNotEmpty()

    if (!hasTimingData) {
        c.addView(grayText(this, "(no timing data)", 12f).apply {
            setPadding(0, dp(Theme.s16), 0, dp(Theme.s16)); gravity = Gravity.CENTER
        })
        return
    }

    buildTransferCards(c)

    val connPhases = listOfNotNull(
        request.dnsMs?.let { Triple("DNS Lookup", it, Theme.timingDNS) },
        request.connectMs?.let { Triple("TCP Handshake", it, Theme.timingTCP) },
        request.tlsMs?.let { Triple("TLS Handshake", it, Theme.timingTLS) },
    )
    if (connPhases.isNotEmpty()) {
        buildTimingSection(c, "Connection", connPhases)
    }

    val respPhases = listOfNotNull(
        request.ttfbMs?.let { Triple("Waiting (TTFB)", it, Theme.timingTTFB) },
        request.downloadMs?.let { Triple("Content Download", it, Theme.timingDownload) },
    )
    if (respPhases.isNotEmpty()) {
        buildTimingSection(c, "Response", respPhases)
    }

    if (request.protocol != null || request.tlsVersion != null || request.cipherSuite != null) {
        buildNetworkInfoSection(c)
    }

    request.durationMs?.let { total ->
        c.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(Theme.s8), 0, dp(Theme.s4))
            addView(TextView(context).apply {
                text = "Total"; textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(null, Typeface.BOLD)
                setTextColor(Theme.text(this@buildTimingTab))
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            })
            addView(TextView(context).apply {
                text = fmtDuration(total); textSize = GeneratedMetrics.FontSize.md.toFloat()
                setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
                setTextColor(Theme.text(this@buildTimingTab))
            })
        })
    }
}

/** Sent/Received transfer size cards — side by side. */
private fun DetailActivity.buildTransferCards(parent: LinearLayout) {
    val sentHeaders = estimateHeaderSize(request.requestHeaders)
    val sentBody = request.requestBodySize
    val recvHeaders = estimateHeaderSize(request.responseHeaders)
    val recvBody = request.responseBodySize

    parent.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, 0, 0, dp(Theme.s8))
        addView(transferCard("↑ Sent", sentHeaders, sentBody, Theme.info),
            LinearLayout.LayoutParams(0, WC, 1f).apply { setMargins(0, 0, dp(Theme.s4), 0) })
        addView(transferCard("↓ Received", recvHeaders, recvBody, Theme.success),
            LinearLayout.LayoutParams(0, WC, 1f))
    })
}

private fun DetailActivity.transferCard(title: String, headerBytes: Long, bodyBytes: Long, color: Int): LinearLayout {
    val total = headerBytes + bodyBytes
    val cardBg = GradientDrawable().apply {
        setColor(Theme.surface(this@transferCard)); cornerRadius = dp(Theme.radiusL).toFloat()
    }
    return LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        background = cardBg; setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
        addView(TextView(context).apply {
            text = title; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
            setTextColor(Theme.text(this@transferCard)); gravity = Gravity.CENTER
        })
        addView(TextView(context).apply {
            text = fmtSize(total).ifEmpty { "0 B" }; textSize = GeneratedMetrics.FontSize.xl.toFloat()
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD); setTextColor(color)
            gravity = Gravity.CENTER; setPadding(0, dp(Theme.s4), 0, dp(Theme.s4))
        })
        addView(transferSizeRow("Headers", headerBytes))
        addView(transferSizeRow("Body", bodyBytes))
    }
}

private fun DetailActivity.transferSizeRow(label: String, bytes: Long) = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(1), 0, dp(1))
    addView(TextView(context).apply {
        text = label; textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTextColor(Theme.textSecondary(this@transferSizeRow))
        layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
    })
    addView(TextView(context).apply {
        text = fmtSize(bytes).ifEmpty { "0 B" }; textSize = GeneratedMetrics.FontSize.xs.toFloat()
        setTypeface(Typeface.MONOSPACE); setTextColor(Theme.textSecondary(this@transferSizeRow))
    })
}

/** A grouped timing section (Connection or Response) with waterfall bars. */
private fun DetailActivity.buildTimingSection(parent: LinearLayout, title: String, phases: List<Triple<String, Long, Int>>) {
    val totalMs = phases.sumOf { it.second }.coerceAtLeast(1)
    val sectionBg = GradientDrawable().apply {
        setColor(Theme.surface(this@buildTimingSection)); cornerRadius = dp(Theme.radiusL).toFloat()
    }
    parent.addView(LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = sectionBg
        setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
        layoutParams = LinearLayout.LayoutParams(MP, WC).apply {
            setMargins(0, 0, 0, dp(Theme.s8))
        }
        addView(TextView(context).apply {
            text = title; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
            setTextColor(Theme.text(this@buildTimingSection))
            setPadding(0, 0, 0, dp(Theme.s4))
        })
        for ((phaseIdx, triple) in phases.withIndex()) {
            val (label, ms, color) = triple
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(Theme.s2), 0, dp(Theme.s2))
                addView(TextView(context).apply {
                    text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat()
                    setTextColor(Theme.textSecondary(this@buildTimingSection))
                    layoutParams = LinearLayout.LayoutParams(dp(100), WC)
                })
                val barBg = GradientDrawable().apply {
                    setColor(color); cornerRadius = dp(Theme.radiusS).toFloat()
                }
                val targetW = ((ms.toFloat() / totalMs) * dp(120)).toInt().coerceAtLeast(dp(4))
                val barView = View(context).apply {
                    background = barBg
                    layoutParams = LinearLayout.LayoutParams(0, dp(14)).apply {
                        setMargins(0, 0, dp(Theme.s6), 0)
                    }
                }
                addView(barView)
                // Staggered width animation
                barView.post {
                    val anim = ValueAnimator.ofInt(0, targetW).apply {
                        duration = 300; startDelay = (phaseIdx * 60).toLong()
                        interpolator = DecelerateInterpolator()
                        addUpdateListener { v ->
                            barView.layoutParams = (barView.layoutParams as LinearLayout.LayoutParams).apply {
                                width = v.animatedValue as Int
                            }
                        }
                    }
                    anim.start()
                }
                addView(monoText(context, "${ms}ms", 10f))
            })
        }
    })
}

/** Network info section: protocol, encryption, cipher. */
private fun DetailActivity.buildNetworkInfoSection(parent: LinearLayout) {
    val sectionBg = GradientDrawable().apply {
        setColor(Theme.surface(this@buildNetworkInfoSection)); cornerRadius = dp(Theme.radiusL).toFloat()
    }
    parent.addView(LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = sectionBg
        setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
        layoutParams = LinearLayout.LayoutParams(MP, WC).apply {
            setMargins(0, 0, 0, dp(Theme.s8))
        }
        addView(TextView(context).apply {
            text = "Network"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
            setTextColor(Theme.text(this@buildNetworkInfoSection))
            setPadding(0, 0, 0, dp(Theme.s4))
        })
        request.protocol?.let { addNetworkRow(this@apply, "Protocol", it.uppercase()) }
        request.tlsVersion?.let { addNetworkRow(this@apply, "Encryption", it) }
        request.cipherSuite?.let { addNetworkRow(this@apply, "Cipher", it) }
    })
}

private fun DetailActivity.addNetworkRow(parent: LinearLayout, label: String, value: String) {
    parent.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
        addView(TextView(context).apply {
            text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(this@addNetworkRow))
            layoutParams = LinearLayout.LayoutParams(dp(80), WC)
        })
        addView(TextView(context).apply {
            text = value; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
            setTextColor(Theme.text(this@addNetworkRow))
        })
    })
}
