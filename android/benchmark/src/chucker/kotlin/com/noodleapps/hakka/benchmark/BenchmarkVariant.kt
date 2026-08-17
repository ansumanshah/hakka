package com.noodleapps.hakka.benchmark

import android.content.Context
import com.chuckerteam.chucker.api.ChuckerCollector
import com.chuckerteam.chucker.api.ChuckerInterceptor
import com.chuckerteam.chucker.api.RetentionManager
import okhttp3.OkHttpClient
import org.json.JSONObject

object BenchmarkVariant {
    fun create(context: Context): BenchmarkRuntime {
        val collector = ChuckerCollector(
            context = context,
            showNotification = false,
            retentionPeriod = RetentionManager.Period.ONE_HOUR,
        )
        val interceptor = ChuckerInterceptor.Builder(context)
            .collector(collector)
            .maxContentLength(262_144L)
            .redactHeaders("Authorization", "Cookie", "Set-Cookie", "X-Api-Key")
            .alwaysReadResponseBody(false)
            .createShortcut(false)
            .build()
        val client = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .build()

        return BenchmarkRuntime(
            variant = "chucker",
            client = client,
            inspect = {
                JSONObject()
                    .put("client", "okhttp+chucker")
                    .put("hakkaEnabled", false)
                    .put("chuckerEnabled", true)
                    .put("showNotification", false)
                    .put("retentionPeriod", "ONE_HOUR")
                    .put("maxContentLength", 262_144)
                    .put("alwaysReadResponseBody", false)
            },
            closeAction = {
                client.dispatcher.executorService.shutdown()
                client.connectionPool.evictAll()
            },
        )
    }
}
