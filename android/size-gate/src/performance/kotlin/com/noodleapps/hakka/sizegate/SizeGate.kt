package com.noodleapps.hakka.sizegate

import android.content.Context
import com.noodleapps.hakka.HakkaPerformance
import okhttp3.OkHttpClient

object SizeGate {
    const val name = "performance"

    private var client: OkHttpClient? = null
    private var performance: HakkaPerformance? = null

    fun install(context: Context): String {
        val activeClient = OkHttpClient.Builder().build()
        client = activeClient
        NetworkExerciser.exercise(activeClient)
        performance = HakkaPerformance {
            sampleIntervalMs = 1_000L
            enableNetworkUsageMetrics = true
            sink { }
        }

        return "Performance linked, interval=${performance?.sampleIntervalMs()}"
    }
}
