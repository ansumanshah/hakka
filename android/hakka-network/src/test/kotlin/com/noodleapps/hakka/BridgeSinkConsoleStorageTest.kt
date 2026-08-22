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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Outbound direction of [BridgeSink]'s console/storage senders — proves the real frames
 * hitting the wire match `packages/hakka-bridge/src/protocol.ts`'s `BridgeConsoleMessage`/
 * `BridgeStorageMessage` shapes, over a real [MockWebServer] socket (not just JSON
 * construction in isolation).
 */
class BridgeSinkConsoleStorageTest {
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
        // These tests only ever close the connection from the client side (never a
        // clean server-initiated close handshake, unlike BridgeSinkTest's inbound-frame
        // tests) — MockWebServer.shutdown() can throw "Gave up waiting for queue to shut
        // down" while forcibly tearing down that still-technically-open connection. All
        // assertions have already run by this point, so a cleanup-time exception here
        // must not fail the test.
        try {
            server.shutdown()
        } catch (_: java.io.IOException) {
            // Best-effort cleanup — see comment above.
        }
    }

    private fun wsUrl() = server.url("/bridge").toString().replace("http://", "ws://")

    /** Connects [sink] and returns every text frame the server side receives, in order. */
    private fun connectAndCapture(): CopyOnWriteArrayList<String> {
        val received = CopyOnWriteArrayList<String>()
        val opened = CountDownLatch(1)
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        opened.countDown()
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        received.add(text)
                    }
                }
            )
        )
        sink = BridgeSink(wsUrl(), client)
        assertTrue(opened.await(5, TimeUnit.SECONDS), "server-side socket never opened")
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
    fun `sendConsole streams a canonical console frame with an array payload`() {
        val received = connectAndCapture()

        sink!!.sendConsole(listOf(LogEntry(id = "log_1", timestamp = 1_732_000_000_000L, level = LogLevel.INFO, message = "app launched")))

        val frame = waitForFrameOfType(received, "console")
        val payload = frame.getJSONArray("payload")
        assertEquals(1, payload.length())
        val entry = payload.getJSONObject(0)
        assertEquals("log_1", entry.getString("id"))
        assertEquals("info", entry.getString("level"))
        assertEquals("app launched", entry.getString("message"))
        assertTrue(!entry.has("category"))
        assertTrue(!entry.has("metadata"))
    }

    @Test
    fun `sendConsole sends a batch of entries as one frame`() {
        val received = connectAndCapture()

        sink!!.sendConsole(
            listOf(
                LogEntry(id = "log_1", timestamp = 1, level = LogLevel.DEBUG, message = "a"),
                LogEntry(id = "log_2", timestamp = 2, level = LogLevel.WARN, message = "b", category = "cache"),
            )
        )

        val frame = waitForFrameOfType(received, "console")
        assertEquals(2, frame.getJSONArray("payload").length())
    }

    @Test
    fun `sendConsole is a no-op for an empty list`() {
        val received = connectAndCapture()
        sink!!.sendConsole(emptyList())
        Thread.sleep(200)
        assertTrue(received.none { JSONObject(it).optString("type") == "console" })
    }

    @Test
    fun `sendStorage streams a canonical storage frame — snapshot-replace shape`() {
        val received = connectAndCapture()

        sink!!.sendStorage(
            StorageSnapshot(
                store = "sharedPreferences:test_prefs",
                timestampMs = 1_732_000_000_000L,
                entries = mapOf("theme" to "dark", "onboardingComplete" to "true"),
            )
        )

        val frame = waitForFrameOfType(received, "storage")
        val payload = frame.getJSONObject("payload")
        assertEquals("sharedPreferences:test_prefs", payload.getString("store"))
        assertEquals(1_732_000_000_000L, payload.getLong("timestamp"))
        assertEquals("dark", payload.getJSONObject("entries").getString("theme"))
    }

    @Test
    fun `sendStorage on an empty snapshot still sends — 0 entries is not malformed`() {
        val received = connectAndCapture()

        sink!!.sendStorage(StorageSnapshot(store = "cookies", entries = emptyMap()))

        val frame = waitForFrameOfType(received, "storage")
        assertEquals(0, frame.getJSONObject("payload").getJSONObject("entries").length())
    }

    @Test
    fun `sendConsole and sendStorage never throw while genuinely disconnected`() {
        // Port 1 refuses the connection outright — the sink stays disconnected for the
        // life of this test. BridgeSink queues everything uniformly while disconnected
        // (unlike hakka-node's fire-and-forget console/storage contract), same as
        // onRecord — the point of this test is that queuing never throws.
        val disconnectedSink = BridgeSink("ws://127.0.0.1:1", client)
        disconnectedSink.sendConsole(listOf(LogEntry(id = "log_1", timestamp = 1, level = LogLevel.INFO, message = "queued")))
        disconnectedSink.sendStorage(StorageSnapshot(store = "test", entries = mapOf("a" to "b")))
        disconnectedSink.close()
    }

    @Test
    fun `a frame sent immediately after construction still reaches the server`() {
        // Fires sendConsole right after constructing the sink, before the caller can
        // observe the handshake completing — proves the queue-then-flush path (or a
        // same-tick send, if the handshake happened to already be up) delivers the frame
        // either way, matching the "never lose a console/storage frame that arrives
        // before or right around connect" contract onRecord already relies on.
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
        sink = BridgeSink(wsUrl(), client)
        sink!!.sendConsole(listOf(LogEntry(id = "log_1", timestamp = 1, level = LogLevel.INFO, message = "immediate")))

        val frame = waitForFrameOfType(received, "console")
        assertEquals("immediate", frame.getJSONArray("payload").getJSONObject(0).getString("message"))
    }
}
