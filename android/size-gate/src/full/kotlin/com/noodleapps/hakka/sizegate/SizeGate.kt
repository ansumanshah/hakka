package com.noodleapps.hakka.sizegate

import android.content.Context
import android.content.Intent
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.ui.HakkaActivity
import com.noodleapps.hakka.ui.HakkaUI
import com.noodleapps.hakka.ui.HakkaUILogListener
import okhttp3.OkHttpClient

object SizeGate {
    const val name = "full"

    private var interceptor: HakkaInterceptor? = null
    private var client: OkHttpClient? = null

    fun install(context: Context): String {
        val ui = HakkaUI.getInstance(context)
        val activeInterceptor = HakkaInterceptor {
            maxRequests = 16
            listener(HakkaUILogListener(ui))
            sink { }
        }
        ui.attach(activeInterceptor.logStore)
        ui.init {
            context.startActivity(
                Intent(context, HakkaActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
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

        return "Core + UI linked, records=${activeInterceptor.logStore.size()}"
    }
}
