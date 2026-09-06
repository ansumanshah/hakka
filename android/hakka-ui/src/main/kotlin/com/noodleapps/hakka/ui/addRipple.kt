package com.noodleapps.hakka.ui

import android.content.Context
import android.view.View

fun View.addRipple(ctx: Context) {
    val attrs = intArrayOf(android.R.attr.selectableItemBackground)
    val ta = ctx.obtainStyledAttributes(attrs)
    foreground = ta.getDrawable(0)
    ta.recycle()
}
