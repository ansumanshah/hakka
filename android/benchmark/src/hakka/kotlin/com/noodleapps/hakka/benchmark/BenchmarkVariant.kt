package com.noodleapps.hakka.benchmark

import android.content.Context
import com.noodleapps.hakka.HakkaInterceptor
import okhttp3.OkHttpClient
import org.json.JSONObject

object BenchmarkVariant {
    fun create(context: Context): BenchmarkRuntime {
        val interceptor = HakkaInterceptor {
            maxRequests = 1_000
            // Exercise Hakka with body capture enabled up to the workload's
            // 256 KB ceiling. A zero cap would skip the body-buffering work this
            // harness is intended to measure.
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
