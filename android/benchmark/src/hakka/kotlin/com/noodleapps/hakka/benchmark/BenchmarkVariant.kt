package com.noodleapps.hakka.benchmark

import android.content.Context
import com.noodleapps.hakka.HakkaInterceptor
import okhttp3.OkHttpClient
import org.json.JSONObject

object BenchmarkVariant {
    fun create(context: Context): BenchmarkRuntime {
        val interceptor = HakkaInterceptor {
            maxRequests = 1_000
            // Match Chucker's 256 KB body-capture cap so the comparison is
            // apples-to-apples: both tools buffer response bodies up to the same
            // limit as the workload drains them. (Previously 0 = body capture
            // off, which understated Hakka's real per-request cost vs Chucker.)
            maxBodySize = 262_144L
            redactHeaders = setOf("authorization", "cookie", "set-cookie", "x-api-key")
            sink { }
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .apply {
                interceptor.eventListenerFactory()?.let { eventListenerFactory(it) }
            }
            .build()

        return BenchmarkRuntime(
            variant = "hakka",
            client = client,
            after = {
                interceptor.flushCaptureProcessing()
                interceptor.flushSinks()
            },
            inspect = {
                val networkHealth = interceptor.healthReport(tags = mapOf("benchmark.variant" to "hakka"))
                JSONObject()
                    .put("client", "okhttp+hakka")
                    .put("hakkaEnabled", true)
                    .put("chuckerEnabled", false)
                    .put("capturedRecords", interceptor.logStore.size())
                    .put("droppedSinkRecords", interceptor.droppedSinkRecords())
                    .put("maxBodySize", 0)
                    .put("performanceEnabled", false)
                    .put("networkSummary", networkHealth.summary)
            },
            closeAction = {
                interceptor.close()
                client.dispatcher.executorService.shutdown()
                client.connectionPool.evictAll()
            },
        )
    }
}
