package com.noodleapps.hakka.sizegate

import android.content.Context
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.HakkaPerformance
import okhttp3.OkHttpClient

object SizeGate {
    const val name = "base-sdk"

    private var interceptor: HakkaInterceptor? = null
    private var client: OkHttpClient? = null
    private var performance: HakkaPerformance? = null

    fun install(context: Context): String {
        val activeInterceptor = HakkaInterceptor {
            maxRequests = 16
            sink { }
        }
        interceptor = activeInterceptor
        val activeClient = OkHttpClient.Builder()
            .addInterceptor(activeInterceptor)
            .apply {
                activeInterceptor.eventListenerFactory()?.let { eventListenerFactory(it) }
            }
            .build()
        client = activeClient
        NetworkExerciser.exercise(activeClient)
        performance = HakkaPerformance {
            sampleIntervalMs = 1_000L
            sink { }
        }

        return "Base SDK linked, records=${activeInterceptor.logStore.size()}, interval=${performance?.sampleIntervalMs()}"
    }
}
