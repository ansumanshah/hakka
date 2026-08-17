package com.noodleapps.hakka.benchmark

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.TextView
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.roundToLong

class BenchmarkActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var status: TextView
    private lateinit var runtime: BenchmarkRuntime

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runtime = BenchmarkVariant.create(this)
        status = TextView(this).apply {
            gravity = Gravity.CENTER
            textSize = 16f
            text = "Hakka benchmark\nvariant=${runtime.variant}\nSet extra run=true to execute."
        }
        setContentView(status)

        if (intent.getBooleanExtra("run", false)) {
            val url = intent.getStringExtra("url") ?: "https://httpbin.org/get"
            val count = intent.getIntExtra("count", 20).coerceIn(1, 1_000)
            runBenchmark(url, count)
        }
    }

    override fun onDestroy() {
        runCatching { runtime.close() }
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun runBenchmark(url: String, count: Int) {
        status.text = "Running ${runtime.variant}\n$url\ncount=$count"
        executor.execute {
            val result = executeRequests(url, count)
            val output = File(filesDir, "hakka-benchmark-result.json")
            output.writeText(result.toString(2))
            Log.i("HakkaBenchmark", result.toString())
            runOnUiThread {
                status.text = "Complete ${runtime.variant}\n${result.optJSONObject("summary")}\n$output"
            }
        }
    }

    private fun executeRequests(url: String, count: Int): JSONObject {
        runtime.beforeRun()
        val timings = JSONArray()
        var successCount = 0
        var failureCount = 0
        var totalRequestDurationMs = 0L
        val startedAt = System.nanoTime()

        repeat(count) { index ->
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer benchmark-token")
                .header("X-Hakka-Benchmark", runtime.variant)
                .build()
            val requestStart = System.nanoTime()
            runCatching {
                runtime.client.newCall(request).execute().use { response ->
                    response.body?.string()
                    val durationMs = elapsedMs(requestStart)
                    totalRequestDurationMs += durationMs
                    if (response.isSuccessful) successCount += 1 else failureCount += 1
                    timings.put(
                        JSONObject()
                            .put("index", index)
                            .put("status", response.code)
                            .put("durationMs", durationMs),
                    )
                }
            }.onFailure { error ->
                val durationMs = elapsedMs(requestStart)
                totalRequestDurationMs += durationMs
                failureCount += 1
                timings.put(
                    JSONObject()
                        .put("index", index)
                        .put("error", error.javaClass.simpleName)
                        .put("message", error.message)
                        .put("durationMs", durationMs),
                )
            }
        }

        runtime.afterRun()
        val elapsed = elapsedMs(startedAt)
        val summary = JSONObject()
            .put("count", count)
            .put("successCount", successCount)
            .put("failureCount", failureCount)
            .put("totalDurationMs", elapsed)
            .put("averageDurationMs", if (count > 0) totalRequestDurationMs.toDouble() / count else 0.0)
            .put("requestsPerSecond", if (elapsed > 0) count * 1000.0 / elapsed else 0.0)

        return JSONObject()
            .put("variant", runtime.variant)
            .put("url", url)
            .put("summary", summary)
            .put("samples", timings)
            .put("inspector", runtime.snapshot())
    }

    private fun elapsedMs(startNanos: Long): Long =
        ((System.nanoTime() - startNanos) / 1_000_000.0).roundToLong()
}
