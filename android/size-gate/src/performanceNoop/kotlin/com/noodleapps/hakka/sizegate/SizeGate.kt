package com.noodleapps.hakka.sizegate

import android.content.Context
import com.noodleapps.hakka.HakkaPerformance
import okhttp3.OkHttpClient

object SizeGate {
    const val name = "performance-noop"

    private var client: OkHttpClient? = null
    private var performance: HakkaPerformance? = null

    fun install(context: Context): String {
        val activeClient = OkHttpClient.Builder().build()
        client = activeClient
        NetworkExerciser.exercise(activeClient)
        performance = HakkaPerformance {
            sampleIntervalMs = 1_000L
            sink { }
        }

        return "Performance noop linked, running=${performance?.isRunning}"
    }
}
