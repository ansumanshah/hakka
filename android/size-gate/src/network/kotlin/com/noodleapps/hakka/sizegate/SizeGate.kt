package com.noodleapps.hakka.sizegate

import android.content.Context
import com.noodleapps.hakka.HakkaInterceptor
import okhttp3.OkHttpClient

object SizeGate {
    const val name = "core"

    private var interceptor: HakkaInterceptor? = null
    private var client: OkHttpClient? = null

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

        return "Core linked, records=${activeInterceptor.logStore.size()}"
    }
}
