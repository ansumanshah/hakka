package com.noodleapps.hakka.rn

import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/**
 * OkHttp network interceptor that adds a runtime tag to every captured request.
 *
 * This interceptor sits at the network layer (addNetworkInterceptor) so it sees
 * the raw bytes after redirects/decompression.  Body reading is non-destructive:
 * we use peekBody() to capture up to [MAX_PEEK_BYTES] without consuming the stream.
 *
 * The interceptor itself does NOT emit to the Hakka log — the existing
 * [NativeCoreDelegate.interceptor] (a HakkaInterceptor from hakka-network) already
 * does the full capture via its own OkHttp Interceptor.  This interceptor's sole
 * job is to stamp the WritableMap with `runtime = "android"` so the JS layer can
 * distinguish native-Android captures from JS-layer captures.
 *
 * Wire-up: [HakkaOkHttpClientFactory] calls addNetworkInterceptor(HakkaNetworkInterceptor())
 * on every new OkHttp client it builds.
 */
internal class HakkaNetworkInterceptor : Interceptor {

    companion object {
        /** Maximum bytes to peek at for body preview. */
        private const val MAX_PEEK_BYTES = 256 * 1024L  // 256 KB
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        // Tag the request so downstream serialisation can stamp runtime='android'.
        val taggedRequest = request.newBuilder()
            .tag(HakkaRuntimeTag::class.java, HakkaRuntimeTag("android"))
            .build()
        return chain.proceed(taggedRequest)
    }
}

/**
 * Lightweight tag attached to OkHttp requests so [NativeCoreDelegate.requestToWritableMap]
 * can stamp `runtime = "android"` when converting to the JS shape.
 */
internal data class HakkaRuntimeTag(val runtime: String)
