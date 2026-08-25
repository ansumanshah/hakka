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
    fun `drainQueue re-enqueues the frame that failed mid-drain instead of dropping it`() {
        // Port 1 refuses the connection outright — same "genuinely disconnected" pattern
        // BridgeSinkConsoleStorageTest uses — so onRecord/sendConsole queue frames instead
        // of sending them, giving drainQueue something to work with in isolation.
        sink = BridgeSink("ws://127.0.0.1:1", client)
        val bridgeSink = sink!!
        (0..3).forEach { i ->
            bridgeSink.sendConsole(listOf(LogEntry(id = "log_$i", timestamp = 0L, level = LogLevel.INFO, message = "m$i")))
        }

        // Simulate onOpen's drain: the 1st send succeeds, the 2nd fails (as if the
        // connection died mid-drain), matching the real webSocket.send() failure path.
        var callCount = 0
        bridgeSink.drainQueue {
            callCount++
            callCount != 2
        }
        assertEquals(2, callCount, "drain should stop right after the failed send")

        // Drain what's left and capture it — the frame that failed above must still be
        // in there (re-enqueued, not dropped), even though its position shifted to the tail.
        val remaining = mutableListOf<String>()
        bridgeSink.drainQueue { frame -> remaining.add(frame); true }

        assertTrue(
            remaining.any { it.contains("\"m1\"") },
            "The frame that failed to send mid-drain was lost instead of being retried: $remaining",
        )
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
