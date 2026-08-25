package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class HakkaWebSocketWrapperTest {
    private lateinit var server: MockWebServer
    private lateinit var logStore: LogStore
    private lateinit var client: OkHttpClient

    @BeforeEach
    fun setup() {
        server = MockWebServer()
        server.start()
        logStore = LogStore(HakkaConfig())
        client = OkHttpClient()
    }

    @AfterEach
    fun teardown() {
        server.shutdown()
        client.dispatcher.executorService.shutdown()
    }

    private fun wsUrl() = server.url("/ws").toString().replace("http://", "ws://")

    // ---- Helper: enqueue a server that closes immediately after open ----

    private fun enqueueClosingServer(code: Int = 1000, reason: String = "bye") {
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.close(code, reason)
            }
        }))
    }

    private fun closeLatch(closed: CountDownLatch): WebSocketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {}
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            // Acknowledge the close handshake so onClosed fires.
            webSocket.close(code, reason)
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            closed.countDown()
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            // Treat failure as close so latch is never stuck
            closed.countDown()
        }
    }

    // ---- Tests ----

    @Test
    fun `send text records outbound frame`() {
        enqueueClosingServer()
        val closed = CountDownLatch(1)
        val prepared = HakkaWebSocketWrapper.prepare(
            url = wsUrl(),
            delegate = closeLatch(closed),
            logStore = logStore,
        )
        // Record sent frames before connecting — wrapper buffers them regardless.
        prepared.webSocket.send("hello")
        prepared.webSocket.send("world")
        client.newWebSocket(Request.Builder().url(wsUrl()).build(), prepared.listener)

        assertTrue(closed.await(5, TimeUnit.SECONDS), "Connection did not close in time")

        val records = logStore.all()
        assertEquals(1, records.size, "Expected one WS capture record")
        val record = records[0]
        assertEquals(RequestSource.NATIVE_WS, record.source)

        val sentFrames = record.wsMessages.filter { it.sent }
        assertEquals(2, sentFrames.size, "Expected 2 sent frames")
        assertEquals("hello", sentFrames[0].data)
        assertFalse(sentFrames[0].binary)
        assertEquals(5L, sentFrames[0].size)
        assertEquals("world", sentFrames[1].data)
    }

    @Test
    fun `received text frames are captured with sent=false`() {
        val serverPayload = "server-push"
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(serverPayload)
                webSocket.close(1000, "done")
            }
        }))

        val closed = CountDownLatch(1)
        val prepared = HakkaWebSocketWrapper.prepare(
            url = wsUrl(),
            delegate = closeLatch(closed),
            logStore = logStore,
        )
        client.newWebSocket(Request.Builder().url(wsUrl()).build(), prepared.listener)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "Connection did not close in time")

        val record = logStore.all().firstOrNull()
        assertNotNull(record)
        val recv = record!!.wsMessages.filter { !it.sent }
        assertEquals(1, recv.size)
        assertEquals(serverPayload, recv[0].data)
        assertFalse(recv[0].binary)
        assertEquals(serverPayload.length.toLong(), recv[0].size)
    }

    @Test
    fun `binary sent frame is base64 encoded when within cap`() {
        enqueueClosingServer()
        val closed = CountDownLatch(1)
        val prepared = HakkaWebSocketWrapper.prepare(
            url = wsUrl(),
            delegate = closeLatch(closed),
            logStore = logStore,
        )
        val bytes = ByteString.of(0x01, 0x02, 0x03)
        prepared.webSocket.send(bytes)
        client.newWebSocket(Request.Builder().url(wsUrl()).build(), prepared.listener)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "Connection did not close in time")

        val record = logStore.all().firstOrNull()
        assertNotNull(record)
        val binaryFrame = record!!.wsMessages.firstOrNull { it.sent && it.binary }
        assertNotNull(binaryFrame)
        assertEquals(3L, binaryFrame!!.size)
        assertNotNull(binaryFrame.data, "Small binary frame should be base-64 encoded")
    }

    @Test
    fun `capture record is stored on normal close code 1000`() {
        enqueueClosingServer(code = 1000)
        val closed = CountDownLatch(1)
        val prepared = HakkaWebSocketWrapper.prepare(
            url = wsUrl(),
            delegate = closeLatch(closed),
            logStore = logStore,
        )
        client.newWebSocket(Request.Builder().url(wsUrl()).build(), prepared.listener)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "Connection did not close in time")

        val records = logStore.all()
        assertEquals(1, records.size)
        val rec = records[0]
        assertEquals(101, rec.status, "Normal close should map to HTTP 101")
        assertEquals(1000, rec.wsCloseCode)
        assertEquals(RequestSource.NATIVE_WS, rec.source)
    }

    @Test
    fun `both directions captured in one record`() {
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send("from-server")
                webSocket.close(1000, "done")
            }
        }))

        val closed = CountDownLatch(1)
        val prepared = HakkaWebSocketWrapper.prepare(
            url = wsUrl(),
            delegate = closeLatch(closed),
            logStore = logStore,
        )
        prepared.webSocket.send("from-client")
        client.newWebSocket(Request.Builder().url(wsUrl()).build(), prepared.listener)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "Connection did not close in time")

        val record = logStore.all().firstOrNull()
        assertNotNull(record)
        val frames = record!!.wsMessages
        assertTrue(frames.any { it.sent && it.data == "from-client" }, "Sent frame missing")
        assertTrue(frames.any { !it.sent && it.data == "from-server" }, "Received frame missing")
    }

    @Test
    fun `prepare is isolated per connection — no cross-contamination`() {
        repeat(2) { enqueueClosingServer() }

        val latch = CountDownLatch(2)
        repeat(2) { i ->
            val prepared = HakkaWebSocketWrapper.prepare(wsUrl(), closeLatch(latch), logStore)
            prepared.webSocket.send("msg-$i")
            client.newWebSocket(Request.Builder().url(wsUrl()).build(), prepared.listener)
        }

        assertTrue(latch.await(10, TimeUnit.SECONDS), "Not all connections closed in time")
        val records = logStore.all()
        assertEquals(2, records.size, "Each WS connection should emit a separate record")
        for (rec in records) {
            val sent = rec.wsMessages.filter { it.sent }
            assertEquals(1, sent.size, "Each record should have exactly 1 sent frame")
        }
    }

    @Test
    fun `send before connection open is recorded but returns false`() {
        // No server enqueued — send() before onOpen is well-defined: returns false
        val prepared = HakkaWebSocketWrapper.prepare(wsUrl(), null, logStore)
        // Before connecting, socketRef is null — send should return false but not crash
        val result = prepared.webSocket.send("early")
        assertFalse(result, "send() before open should return false (no socket yet)")
    }

    @Test
    fun `frames are capped at MAX_FRAMES, dropping oldest first`() {
        // No connection needed — send() buffers frames regardless of socket state, and
        // emit() (internal) lets the test read the resulting capture without a real
        // round trip through MockWebServer.
        val prepared = HakkaWebSocketWrapper.prepare(wsUrl(), null, logStore)
        val overflow = 5
        repeat(HakkaWebSocketWrapper.MAX_FRAMES + overflow) { i ->
            prepared.webSocket.send("frame-$i")
        }
        prepared.webSocket.emit(1000, null)

        val record = logStore.all().firstOrNull()
        assertNotNull(record)
        val frames = record!!.wsMessages
        assertEquals(
            HakkaWebSocketWrapper.MAX_FRAMES,
            frames.size,
            "Frame count should be capped at MAX_FRAMES instead of growing without bound",
        )
        // Drop-oldest: the retained frames should be the last MAX_FRAMES sent, in order.
        assertEquals("frame-$overflow", frames.first().data, "Oldest frames should have been evicted")
        assertEquals(
            "frame-${HakkaWebSocketWrapper.MAX_FRAMES + overflow - 1}",
            frames.last().data,
            "Newest frame should be retained",
        )
    }
}
