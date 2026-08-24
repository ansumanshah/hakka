package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * A genuine (non-mocked) `chain.proceed()` failure — distinct from
 * [HakkaInterceptorFailureTest], which only exercises [MockEngine]'s deliberately-mapped
 * failure codes. Pins that `intercept()` rethrows the exception OkHttp itself threw, not a
 * fresh, generically-typed [IOException] built from its message.
 */
class HakkaInterceptorRealNetworkFailureTest {
    private lateinit var server: MockWebServer

    @BeforeEach
    fun setup() {
        MockEngine.shared.clearRules()
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun teardown() {
        MockEngine.shared.clearRules()
        server.shutdown()
    }

    @Test
    fun `preserves the original exception subtype from a real chain proceed failure`() {
        server.enqueue(MockResponse().setHeadersDelay(2, TimeUnit.SECONDS))
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .readTimeout(200, TimeUnit.MILLISECONDS)
            .build()

        val call = client.newCall(Request.Builder().url(server.url("/slow")).build())
        val error = assertThrows(IOException::class.java) { call.execute() }

        // Before the fix, intercept() discards the exception caught around chain.proceed()
        // and rethrows `IOException(error.message)` — a generic IOException that loses the
        // SocketTimeoutException subtype host code relies on for retry/backoff decisions.
        assertTrue(
            error is java.net.SocketTimeoutException,
            "expected SocketTimeoutException, got ${error::class.java.simpleName}: ${error.message}",
        )
        assertTrue(interceptor.flushCaptureProcessing())
        val req = interceptor.logStore.all().single()
        assertTrue(req.error?.isNotBlank() == true)
    }
}
