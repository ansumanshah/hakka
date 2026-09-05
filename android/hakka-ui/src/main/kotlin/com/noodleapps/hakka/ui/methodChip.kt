package com.noodleapps.hakka.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

fun methodChip(ctx: Context, method: String, widthDp: Int = 52, sp: Float = 10f): TextView {
    val color = methodColor(method)
    val bg = GradientDrawable().apply {
        cornerRadius = dp(ctx.resources, Theme.radiusS).toFloat()
        setColor(Color.argb(26, Color.red(color), Color.green(color), Color.blue(color))) // ~10%
        setStroke(dp(ctx.resources, 1), Color.argb(102, Color.red(color), Color.green(color), Color.blue(color))) // ~40%
    }
    return TextView(ctx).apply {
        text = method; textSize = sp; gravity = Gravity.CENTER
        setTextColor(color); setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        background = bg
        setPadding(dp(ctx.resources, Theme.s4), dp(ctx.resources, 2), dp(ctx.resources, Theme.s4), dp(ctx.resources, 2))
        layoutParams = LinearLayout.LayoutParams(dp(ctx.resources, widthDp), WC)
    }
}
