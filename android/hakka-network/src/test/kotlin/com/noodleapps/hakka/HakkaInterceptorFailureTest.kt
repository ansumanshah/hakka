package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * End-to-end `failure`-mode tests through [HakkaInterceptor] — split out of
 * [HakkaInterceptorTest] to keep files small. Mirrors that file's `block`
 * coverage exactly, plus the failure/block precedence rule.
 */
class HakkaInterceptorFailureTest {
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
    fun `failure throws the mapped IOException subtype and never reaches the real server`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/flaky",
                response = MockResponse(),
                failure = MockFailure(MockFailureCode.TIMEOUT),
            )
        )
        val captured = mutableListOf<NetworkRequest>()
        val interceptor = HakkaInterceptor { listener { captured.add(it) } }
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val call = client.newCall(Request.Builder().url(server.url("/flaky")).build())
        val error = assertThrows(java.io.IOException::class.java) { call.execute() }
        assertTrue(error is java.net.SocketTimeoutException)
        assertEquals(0, server.requestCount)

        assertTrue(interceptor.flushCaptureProcessing())
        val req = interceptor.logStore.all().single()
        assertNull(req.status)
        assertEquals(MockFailureCode.TIMEOUT.message, req.error)
        assertEquals(req, captured.single())
    }

    @Test
    fun `failure takes priority over block`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/both",
                response = MockResponse(),
                block = true,
                failure = MockFailure(MockFailureCode.CANNOT_FIND_HOST),
            )
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val call = client.newCall(Request.Builder().url(server.url("/both")).build())
        val error = assertThrows(java.io.IOException::class.java) { call.execute() }
        assertTrue(error is java.net.UnknownHostException)
        assertEquals("Mocked failure: cannot find host", error.message)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `every MockFailureCode maps to its documented IOException subtype`() {
        val expectations: Map<MockFailureCode, Class<out java.io.IOException>> = mapOf(
            MockFailureCode.TIMEOUT to java.net.SocketTimeoutException::class.java,
            MockFailureCode.NO_CONNECTION to java.net.UnknownHostException::class.java,
            MockFailureCode.CANNOT_FIND_HOST to java.net.UnknownHostException::class.java,
            MockFailureCode.CANNOT_CONNECT_TO_HOST to java.net.ConnectException::class.java,
            MockFailureCode.CONNECTION_LOST to java.io.IOException::class.java,
            MockFailureCode.SECURE_CONNECTION_FAILED to javax.net.ssl.SSLException::class.java,
            MockFailureCode.CANCELLED to java.io.IOException::class.java,
            MockFailureCode.UNKNOWN to java.io.IOException::class.java,
        )
        for ((code, expectedType) in expectations) {
            MockEngine.shared.clearRules()
            MockEngine.shared.addRule(
                MockRuleInput(pattern = "/x", response = MockResponse(), failure = MockFailure(code))
            )
            val interceptor = HakkaInterceptor()
            val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
            val call = client.newCall(Request.Builder().url(server.url("/x")).build())
            val error = assertThrows(java.io.IOException::class.java) { call.execute() }
            assertTrue(expectedType.isInstance(error), "expected ${expectedType.simpleName} for ${code.wireValue}, got ${error::class.java.simpleName}")
        }
    }

    @Test
    fun `skipCount 1 then failure — first request is real, second fails`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/retry",
                response = MockResponse(),
                failure = MockFailure(MockFailureCode.CONNECTION_LOST),
                skipCount = 1,
            )
        )
        server.enqueue(okhttp3.mockwebserver.MockResponse().setBody("real").setResponseCode(200))
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()

        val first = client.newCall(Request.Builder().url(server.url("/retry")).build()).execute()
        assertEquals(200, first.code)
        first.close()

        assertThrows(java.io.IOException::class.java) {
            client.newCall(Request.Builder().url(server.url("/retry")).build()).execute()
        }
        assertEquals(1, server.requestCount)
    }
}
