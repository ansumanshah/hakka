package com.noodleapps.hakka.rn

import android.content.Context
import android.util.Log
import com.chuckerteam.chucker.api.ChuckerCollector
import com.chuckerteam.chucker.api.ChuckerInterceptor
import com.chuckerteam.chucker.api.ExportFormat
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.Base64

/** Installs the comparison inspector in its dedicated flavor. */
object BenchmarkNetworking {
  private lateinit var collector: ChuckerCollector

  @JvmStatic
  fun install(context: Context) {
    collector = ChuckerCollector(context, false)
    OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient = OkHttpClientProvider.createClientBuilder()
        .addInterceptor(ChuckerInterceptor.Builder(context).collector(collector).build())
        .build()
    })
  }

  @JvmStatic
  fun getPersistedCaptureCount(context: Context): Int {
    val uri = collector.writeTransactions(context, 0, ExportFormat.HAR) ?: return 0
    val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: return 0
    val entries = JSONObject(text).getJSONObject("log").getJSONArray("entries")
    if (entries.length() != EXPECTED_CAPTURE_COUNT) return entries.length()
    val validation = runCatching {
      repeat(entries.length()) { index ->
        val entry = entries.getJSONObject(index)
        val url = entry.getJSONObject("request").getString("url")
        val expectedSize = Regex("/payload/(0|256|16384)(?:\\?|$)").find(url)?.groupValues?.get(1)?.toInt()
          ?: error("Unexpected captured URL: $url")
        val content = entry.getJSONObject("response").getJSONObject("content")
        check(content.getLong("size") == expectedSize.toLong()) { "Chucker retained size mismatch for $url" }
        val encodedBody = content.optString("text", "")
        val bodySize = if (content.optString("encoding") == "base64") {
          Base64.getDecoder().decode(encodedBody).size
        } else {
          encodedBody.toByteArray().size
        }
        check(bodySize == expectedSize) { "Chucker retained body mismatch for $url: expected $expectedSize, received $bodySize" }
      }
    }
    if (validation.isFailure) {
      Log.w("HakkaRNBenchmark", "Capture persistence incomplete: ${validation.exceptionOrNull()?.message}")
      return EXPECTED_CAPTURE_COUNT - 1
    }
    return EXPECTED_CAPTURE_COUNT
  }

  private const val EXPECTED_CAPTURE_COUNT = 100
}
