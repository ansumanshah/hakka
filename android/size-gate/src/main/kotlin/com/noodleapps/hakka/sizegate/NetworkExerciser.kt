package com.noodleapps.hakka.sizegate

import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Exercises the same OkHttp request path from every size-gate flavor, including
 * the OkHttp-only `baseline`.
 *
 * Without this, `baseline` builds an [OkHttpClient] but never calls it, so R8's
 * static reachability analysis can shrink away OkHttp's real network layer
 * (Dispatcher, RealConnection, the HTTP/1.1 and TLS codecs) there — while every
 * Hakka variant keeps that same surface reachable because `HakkaInterceptor`
 * itself references it (Response.Builder, Headers, HttpUrl, ...). That mismatch
 * charged the measured Hakka delta for OkHttp's own reachable code, not
 * Hakka's, and made `baseline` an unrepresentative control (a real host app
 * that links OkHttp uses it to make requests).
 *
 * The call runs on a background thread and swallows any failure — this app is
 * built for `apkanalyzer`/size measurement, never launched against a live
 * network, so the request is never expected to succeed. What matters for R8 is
 * that `client.newCall(...).execute()` is statically present in every flavor's
 * bytecode, not that it runs to completion.
 */
internal object NetworkExerciser {
    fun exercise(client: OkHttpClient) {
        Thread {
            runCatching {
                client.newCall(Request.Builder().url("https://example.invalid/").build())
                    .execute()
                    .use { }
            }
        }.start()
    }
}
