package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList

/**
 * [HakkaInterceptor.sendConsoleFrame]/[sendStorageFrame] — proves the entry points a host
 * app (or [com.noodleapps.hakka.ui.Hakka.log]/`StorageTabController` on the `hakka-ui` side)
 * actually calls reach a real bridge hub through the [BridgeSink] registered from
 * [HakkaInterceptor.Builder.bridgeUrl] and from [connectBridge].
 */
class HakkaInterceptorBridgeSendTest {
    private lateinit var server: MockWebServer

    @BeforeEach
    fun setup() {
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun teardown() {
        // Only ever closed from the client side in these tests — see the equivalent
        // comment in BridgeSinkConsoleStorageTest.teardown() for why MockWebServer's
        // shutdown() can throw here even though every assertion above already passed.
        try {
            server.shutdown()
        } catch (_: java.io.IOException) {
            // Best-effort cleanup.
        }
    }

    private fun wsUrl() = server.url("/bridge").toString().replace("http://", "ws://")

    private fun enqueueCapturingSocket(): CopyOnWriteArrayList<String> {
        val received = CopyOnWriteArrayList<String>()
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        received.add(text)
                    }
                }
            )
        )
        return received
    }

    private fun waitForFrameOfType(received: List<String>, type: String): JSONObject {
        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline) {
            val frame = received.map { JSONObject(it) }.find { it.optString("type") == type }
            if (frame != null) return frame
            Thread.sleep(20)
        }
        throw AssertionError("no '$type' frame arrived within 5s — received: $received")
    }

    @Test
    fun `sendConsoleFrame reaches the bridge attached via Builder bridgeUrl`() {
        val received = enqueueCapturingSocket()
        val interceptor = HakkaInterceptor { bridgeUrl = wsUrl() }

        interceptor.sendConsoleFrame(listOf(LogEntry(id = "log_1", timestamp = 1, level = LogLevel.INFO, message = "hello")))

        val frame = waitForFrameOfType(received, "console")
        assertEquals("hello", frame.getJSONArray("payload").getJSONObject(0).getString("message"))
        interceptor.close()
    }

    @Test
    fun `sendStorageFrame reaches the bridge attached via Builder bridgeUrl`() {
        val received = enqueueCapturingSocket()
        val interceptor = HakkaInterceptor { bridgeUrl = wsUrl() }

        interceptor.sendStorageFrame(StorageSnapshot(store = "sharedPreferences:prefs", entries = mapOf("k" to "v")))

        val frame = waitForFrameOfType(received, "storage")
        assertEquals("sharedPreferences:prefs", frame.getJSONObject("payload").getString("store"))
        interceptor.close()
    }

    @Test
    fun `sendConsoleFrame and sendStorageFrame are no-ops when no bridge is attached`() {
        val interceptor = HakkaInterceptor {}
        // Must not throw with zero registered bridge sinks.
        interceptor.sendConsoleFrame(listOf(LogEntry(id = "log_1", timestamp = 1, level = LogLevel.INFO, message = "x")))
        interceptor.sendStorageFrame(StorageSnapshot(store = "x", entries = emptyMap()))
        interceptor.close()
    }

    @Test
    fun `sendConsoleFrame reaches a bridge attached later via connectBridge`() {
        val received = enqueueCapturingSocket()
        val interceptor = HakkaInterceptor {}
        val client = OkHttpClient()
        val connection = interceptor.connectBridgeForTest(wsUrl(), client)

        interceptor.sendConsoleFrame(listOf(LogEntry(id = "log_1", timestamp = 1, level = LogLevel.INFO, message = "discovered")))

        val frame = waitForFrameOfType(received, "console")
        assertEquals("discovered", frame.getJSONArray("payload").getJSONObject(0).getString("message"))

        connection.close()
        interceptor.close()
        client.dispatcher.executorService.shutdown()
    }
}

/** Test-only overload of [connectBridge] that reuses a caller-provided [OkHttpClient]. */
private fun HakkaInterceptor.connectBridgeForTest(url: String, client: OkHttpClient): AutoCloseable {
    val sink = BridgeSink(url, client)
    val subscription = addSink(sink)
    registerBridgeSink(sink)
    return AutoCloseable {
        subscription.close()
        unregisterBridgeSink(sink)
        sink.close()
    }
}
