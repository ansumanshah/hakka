package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/** Styles the method label in the floating traffic bubble. */
internal fun styleAsPlainMethodText(tv: TextView, method: String, widthDp: Int = 52, sp: Float = 11f) {
    tv.text = method
    tv.textSize = sp
    tv.gravity = Gravity.START or Gravity.CENTER_VERTICAL
    tv.setTextColor(methodColor(method))
    tv.setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
    tv.background = null
    tv.setPadding(0, 0, 0, 0)
    tv.layoutParams = LinearLayout.LayoutParams(dp(tv.resources, widthDp), WC)
}
