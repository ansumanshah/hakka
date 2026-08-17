package com.noodleapps.hakka.benchmark

import android.content.Context
import okhttp3.OkHttpClient
import org.json.JSONObject

object BenchmarkVariant {
    fun create(context: Context): BenchmarkRuntime {
        val client = OkHttpClient.Builder().build()
        return BenchmarkRuntime(
            variant = "baseline",
            client = client,
            inspect = {
                JSONObject()
                    .put("client", "okhttp")
                    .put("hakkaEnabled", false)
                    .put("chuckerEnabled", false)
            },
            closeAction = {
                client.dispatcher.executorService.shutdown()
                client.connectionPool.evictAll()
            },
        )
    }
}
