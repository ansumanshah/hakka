package com.noodleapps.hakka.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * BroadcastReceiver for notification actions (clear).
 * Uses the [HakkaUI] singleton so the clear actually affects the running instance.
 */
class HakkaNotificationReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            HakkaNotificationManager.ACTION_CLEAR -> {
                // Clear notification + counters only — do not stop the shake detector.
                HakkaUI.getInstance(context).clearNotification()
            }
        }
    }
}
