package com.noodleapps.hakka.sizegate

import android.content.Context
import okhttp3.OkHttpClient

object SizeGate {
    const val name = "baseline"

    private var client: OkHttpClient? = null

    fun install(context: Context): String {
        val activeClient = OkHttpClient.Builder().build()
        client = activeClient
        NetworkExerciser.exercise(activeClient)
        return "Host OkHttp linked, no Hakka artifacts"
    }
}
