package com.noodleapps.hakka.rn

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/** Converts OkHttp [Headers] to a flat Map, last value wins for duplicates. */
private fun Headers.toSingleValueMap(): Map<String, String> {
    val map = LinkedHashMap<String, String>()
    for (i in 0 until size) map[name(i)] = value(i)
    return map
}

/** Mirrors hakka-network's `HakkaInterceptor.isTextContentType` exactly. */
private val TEXT_CONTENT_TYPES = setOf(
    "text", "application/json", "application/xml", "application/javascript",
    "application/x-www-form-urlencoded", "application/graphql", "application/ld+json",
    "application/manifest+json", "application/xhtml+xml",
)

private fun isTextContentType(contentType: String?): Boolean {
    if (contentType == null) return true // unknown — attempt the body rewrite
    val lower = contentType.lowercase()
    return lower.startsWith("text/") || TEXT_CONTENT_TYPES.any { lower.startsWith(it) }
}

/**
 * Maps a [MockFailureCode] to the [IOException] subtype OkHttp callers actually see —
 * mirrors `MockFailureCode`'s cross-runtime mapping table in
 * `packages/hakka-core/src/engine/MockEngine.ts` (and hakka-network's identical helper).
 */
private fun ioExceptionForFailure(code: MockFailureCode): IOException = when (code) {
    MockFailureCode.TIMEOUT -> java.net.SocketTimeoutException(code.message)
    MockFailureCode.NO_CONNECTION -> java.net.UnknownHostException(code.message)
    MockFailureCode.CANNOT_FIND_HOST -> java.net.UnknownHostException(code.message)
    MockFailureCode.CANNOT_CONNECT_TO_HOST -> java.net.ConnectException(code.message)
    MockFailureCode.CONNECTION_LOST -> IOException(code.message)
    MockFailureCode.SECURE_CONNECTION_FAILED -> javax.net.ssl.SSLException(code.message)
    MockFailureCode.CANCELLED -> IOException(code.message)
    MockFailureCode.UNKNOWN -> IOException(code.message)
}

/**
 * Injects Hakka interceptor into React Native's OkHttp client.
 *
 * Called from [NativeCoreDelegate.initialize] during native module startup.
 * Uses [OkHttpClientProvider.setOkHttpClientFactory] so all RN fetch/XHR
 * traffic flows through [NativeCoreDelegate.interceptor].
 *
 * The factory's [createNewNetworkModuleClient] is called once — the result
 * is cached by OkHttpClientProvider for the app's lifetime.
 */
object HakkaOkHttpClientFactory {
    private var isInitialized = false

    private class NativeMockInterceptor : Interceptor {
        private val fallbackMediaType = "application/json".toMediaType()

        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            val matchedRule = HakkaMockEngine.matchRequest(
                request.url.toString(),
                request.method,
            )
            val globalDelayMs = HakkaMockEngine.getGlobalDelayMs()
            val matchedDelayMs = matchedRule?.delayMs ?: 0L
            val totalDelayMs = globalDelayMs + matchedDelayMs
            if (totalDelayMs > 0L) {
                Thread.sleep(totalDelayMs)
            }

            if (matchedRule == null) {
                return chain.proceed(request)
            }

            // `failure` takes priority over `block`, which takes priority over
            // `redirectTo`/`modify` (mirrors MockEngine.ts's fetch-interceptor ordering:
            // failure, then block, then isRewrite). A more precise simulation than block's
            // generic "Blocked by Hakka" — throws the specific IOException subtype the
            // failure code declares.
            if (matchedRule.failure != null) {
                throw ioExceptionForFailure(matchedRule.failure.code)
            }

            // `block` takes priority over `redirectTo`/`modify`. Abort with an IOException
            // before the real request is ever sent — the outer
            // [NativeCoreDelegate.interceptor] further out in this same OkHttp chain still
            // records this as a completed capture with an error, same as any other IOException.
            if (matchedRule.block) {
                throw IOException("Blocked by Hakka")
            }

            // Passthrough-then-transform path: issue the real request, then rewrite the
            // outgoing URL/headers (redirectTo + modify's request-side edits) and/or the real
            // response (modify's status/header/body edits). Mirrors hakka-network's
            // `MockEngine.kt`/`HakkaInterceptor.interceptRewrite` exactly, minus its own capture
            // bookkeeping — the outer interceptor already records whatever response comes back.
            if (matchedRule.isRewrite) {
                return interceptRewrite(chain, matchedRule, request)
            }

            val body = matchedRule.body
                .toResponseBody(fallbackMediaType)
            val responseBuilder = Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(matchedRule.status)
                .message("Hakka Android Mock")
                .body(body)
                .receivedResponseAtMillis(System.currentTimeMillis())
                .sentRequestAtMillis(System.currentTimeMillis())

            for ((headerName, headerValue) in matchedRule.headers) {
                responseBuilder.addHeader(headerName, headerValue)
            }

            return responseBuilder.build()
        }

        /**
         * Handles a matched rewrite-mode rule (`redirectTo` and/or `modify`): applies the
         * request-side edits — `redirectTo` rewrites the URL first, then `modify`'s query/header
         * edits apply on top of the (possibly redirected) URL, mirroring `MockEngine.ts`'s
         * `applyRewriteRequest` ordering — issues the real request via [chain], then applies the
         * response-side edits (status/header overrides + a plain-string body find/replace,
         * re-wrapped into a fresh [okhttp3.ResponseBody]) before returning.
         */
        @Throws(IOException::class)
        private fun interceptRewrite(chain: Interceptor.Chain, rule: HakkaMockRule, request: Request): Response {
            val modify = rule.modify
            var rewrittenRequest = request

            // redirectTo first, then modify's query edits on top of the (possibly redirected) URL.
            var urlString = rewrittenRequest.url.toString()
            if (!rule.redirectTo.isNullOrEmpty()) {
                urlString = rule.redirectTo
            }
            if (modify != null) {
                urlString = MockRuleTransform.applyQueryEdits(urlString, modify.setQueryParams, modify.removeQueryParams)
            }
            if (urlString != rewrittenRequest.url.toString()) {
                urlString.toHttpUrlOrNull()?.let { newUrl ->
                    rewrittenRequest = rewrittenRequest.newBuilder().url(newUrl).build()
                }
            }

            // modify's request-header edits, on top of the (possibly redirected) request.
            if (modify != null && (modify.setRequestHeaders != null || modify.removeRequestHeaders != null)) {
                val newHeaders = MockRuleTransform.applyHeaderEdits(
                    headers = rewrittenRequest.headers.toSingleValueMap(),
                    set = modify.setRequestHeaders,
                    remove = modify.removeRequestHeaders,
                )
                val headersBuilder = Headers.Builder()
                for ((k, v) in newHeaders) headersBuilder.add(k, v)
                rewrittenRequest = rewrittenRequest.newBuilder().headers(headersBuilder.build()).build()
            }

            val response = chain.proceed(rewrittenRequest)

            if (modify == null) return response

            // modify's response-side edits: status override, header set/remove, and (text
            // bodies only) a plain-string body find/replace. Unlike hakka-network's bounded/typed
            // capture buffer, this vendored engine has no size cap, so the body is only read via
            // `.string()` when there is a `replaceBody` edit AND the content type is textual —
            // otherwise it passes through unconsumed to avoid OOM on large binary payloads.
            val newStatus = modify.status ?: response.code
            val newHeadersMap = MockRuleTransform.applyHeaderEdits(
                headers = response.headers.toSingleValueMap(),
                set = modify.setResponseHeaders,
                remove = modify.removeResponseHeaders,
            )
            val headersBuilder = Headers.Builder()
            for ((k, v) in newHeadersMap) headersBuilder.add(k, v)

            val originalContentType = response.body?.contentType()?.toString()
            val hasBodyEdits = !modify.replaceBody.isNullOrEmpty()
            if (!hasBodyEdits || !isTextContentType(originalContentType)) {
                return response.newBuilder()
                    .code(newStatus)
                    .headers(headersBuilder.build())
                    .build()
            }

            val respBodyText = response.body?.string() ?: ""
            val newBodyText = MockRuleTransform.applyBodyReplacements(respBodyText, modify.replaceBody)
            val ct = (
                newHeadersMap["content-type"]
                    ?: newHeadersMap["Content-Type"]
                    ?: originalContentType
                    ?: "application/octet-stream"
                ).toMediaType()

            return response.newBuilder()
                .code(newStatus)
                .headers(headersBuilder.build())
                .body(newBodyText.toResponseBody(ct))
                .build()
        }
    }

    fun initialize() {
        if (isInitialized) return

        try {
            OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
                override fun createNewNetworkModuleClient(): OkHttpClient {
                    val builder = OkHttpClientProvider.createClientBuilder()
                    builder.addInterceptor(NativeCoreDelegate.interceptor)
                    builder.addInterceptor(NativeMockInterceptor())
                    // Network-layer interceptor stamps runtime='android' tag on requests.
                    builder.addNetworkInterceptor(HakkaNetworkInterceptor())
                    return builder.build()
                }
            })
            isInitialized = true
        } catch (e: Exception) {
            android.util.Log.e("HakkaOkHttpClientFactory", "Failed to inject interceptor", e)
        }
    }
}
