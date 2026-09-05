package com.noodleapps.hakka.ui

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator

/** Haptic feedback helpers. */
internal object Haptics {
    fun light(context: Context) = vibrate(context, 10)
    fun medium(context: Context) = vibrate(context, 25)
    fun success(context: Context) = vibrate(context, 15)
    fun warning(context: Context) = vibrate(context, 30)

    @Suppress("DEPRECATION")
    private fun vibrate(context: Context, ms: Long) {
        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            vibrator.vibrate(ms)
        }
    }
}
