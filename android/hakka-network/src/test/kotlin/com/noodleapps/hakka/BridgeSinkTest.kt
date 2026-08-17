package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Integration test for [BridgeSink]'s inbound control-frame handling — verifies the real
 * [okhttp3.WebSocketListener.onMessage] override (not just [handleInboundFrame] in
 * isolation) drives the engine singletons when a control frame arrives over the wire.
 */
class BridgeSinkTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient
    private var sink: BridgeSink? = null

    @BeforeEach
    fun setup() {
        server = MockWebServer()
        server.start()
        client = OkHttpClient()
    }

    @AfterEach
    fun teardown() {
        sink?.close()
        client.dispatcher.executorService.shutdown()
        server.shutdown()
        MockEngine.shared.clearRules()
        BreakpointEngine.shared.clearBreakpoints()
        ThrottleEngine.shared.setProfile(ThrottleProfile.NONE)
    }

    private fun wsUrl() = server.url("/bridge").toString().replace("http://", "ws://")

    @Test
    fun `BridgeSink applies a control frame pushed from the server`() {
        val closed = CountDownLatch(1)
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        webSocket.send(
                            """{"type":"control","payload":{"kind":"throttle.set","profile":"slow-3g"}}"""
                        )
                        webSocket.close(1000, "done")
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        closed.countDown()
                    }
                }
            )
        )

        sink = BridgeSink(wsUrl(), client)

        // Poll briefly for the async onMessage dispatch to land.
        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline && ThrottleEngine.shared.config.profile != ThrottleProfile.SLOW_3G) {
            Thread.sleep(20)
        }
        assertEquals(ThrottleProfile.SLOW_3G, ThrottleEngine.shared.config.profile)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "server-side socket never closed")
    }

    @Test
    fun `BridgeSink applies a mock-add control frame with replace-by-id`() {
        val closed = CountDownLatch(1)
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        webSocket.send(
                            """{"type":"control","payload":{"kind":"mock.add","rule":{"id":"srv-mock","pattern":"/api","response":{"status":503,"body":"down"},"enabled":true}}}"""
                        )
                        webSocket.close(1000, "done")
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        closed.countDown()
                    }
                }
            )
        )

        sink = BridgeSink(wsUrl(), client)

        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline && MockEngine.shared.getRules().none { it.id == "srv-mock" }) {
            Thread.sleep(20)
        }
        val rule = MockEngine.shared.getRules().find { it.id == "srv-mock" }
        assertNotNull(rule)
        assertEquals(503, rule!!.response.status)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "server-side socket never closed")
    }

    @Test
    fun `BridgeSink never throws when the server sends a hostile frame`() {
        val closed = CountDownLatch(1)
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        webSocket.send("not json{{")
                        webSocket.send("""{"type":"control","payload":{"kind":"mock.remove","id":"../etc/passwd"}}""")
                        webSocket.close(1000, "done")
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        closed.countDown()
                    }
                }
            )
        )

        // Constructing and using the sink must not throw even though the server immediately
        // pushes malformed / hostile frames.
        sink = BridgeSink(wsUrl(), client)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "server-side socket never closed")
        Thread.sleep(200) // let onMessage dispatch settle
        assertTrue(MockEngine.shared.getRules().isEmpty())
    }
}
