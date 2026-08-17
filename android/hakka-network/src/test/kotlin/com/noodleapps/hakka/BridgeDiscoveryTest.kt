package com.noodleapps.hakka

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.WebSocketListener
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A [BridgeHostBrowser] fake that reports a scripted sequence of host sets — one set per
 * [start] call — so [HakkaBridgeDiscoveryTest] can exercise the 0/1/many/retry-once
 * semantics deterministically, without a real [android.net.nsd.NsdManager] (this module
 * has no Android SDK dependency to begin with — see [BridgeHostBrowser]'s doc comment).
 */
private class ScriptedBridgeHostBrowser(
    private val resultsPerAttempt: List<List<DiscoveredBridgeHost>>,
) : BridgeHostBrowser {
    var startCallCount = 0
        private set
    var stopCallCount = 0
        private set

    override fun start(onHostsChanged: (List<DiscoveredBridgeHost>) -> Unit) {
        val hosts = resultsPerAttempt.getOrElse(startCallCount) { emptyList() }
        startCallCount += 1
        onHostsChanged(hosts)
    }

    override fun stop() {
        stopCallCount += 1
    }
}

class BridgeDiscoverySelectorTest {
    @Test
    fun `zero hosts selects None`() {
        assertEquals(BridgeDiscoverySelection.None, BridgeDiscoverySelector.select(emptyList()))
    }

    @Test
    fun `one host selects AutoConnect`() {
        val host = DiscoveredBridgeHost("192.168.1.5", 8989)
        assertEquals(BridgeDiscoverySelection.AutoConnect(host), BridgeDiscoverySelector.select(listOf(host)))
    }

    @Test
    fun `two hosts selects Ambiguous`() {
        val a = DiscoveredBridgeHost("192.168.1.5", 8989)
        val b = DiscoveredBridgeHost("192.168.1.6", 8989)
        assertEquals(BridgeDiscoverySelection.Ambiguous(listOf(a, b)), BridgeDiscoverySelector.select(listOf(a, b)))
    }

    @Test
    fun `webSocketUrl formats as ws scheme`() {
        val host = DiscoveredBridgeHost("192.168.1.5", 8989)
        assertEquals("ws://192.168.1.5:8989", host.webSocketUrl)
    }
}

class HakkaBridgeDiscoveryTest {

    private fun awaitSelection(discovery: HakkaBridgeDiscovery): BridgeDiscoverySelection {
        val latch = CountDownLatch(1)
        var result: BridgeDiscoverySelection? = null
        discovery.start { selection ->
            result = selection
            latch.countDown()
        }
        assertTrue(latch.await(5, TimeUnit.SECONDS), "discovery never settled")
        return result ?: error("no selection recorded")
    }

    @Test
    fun `zero hosts on both attempts resolves to None after exactly one retry`() {
        val browser = ScriptedBridgeHostBrowser(resultsPerAttempt = listOf(emptyList(), emptyList()))
        val discovery = HakkaBridgeDiscovery(browser, timeoutMs = 20L)

        val selection = awaitSelection(discovery)

        assertEquals(BridgeDiscoverySelection.None, selection)
        assertEquals(2, browser.startCallCount, "expected exactly one retry after an empty first attempt")
    }

    @Test
    fun `one host on the first attempt auto-connects without retrying`() {
        val host = DiscoveredBridgeHost("192.168.1.5", 8989)
        val browser = ScriptedBridgeHostBrowser(resultsPerAttempt = listOf(listOf(host)))
        val discovery = HakkaBridgeDiscovery(browser, timeoutMs = 20L)

        val selection = awaitSelection(discovery)

        assertEquals(BridgeDiscoverySelection.AutoConnect(host), selection)
        assertEquals(1, browser.startCallCount)
    }

    @Test
    fun `one host found only on the retry still auto-connects`() {
        val host = DiscoveredBridgeHost("192.168.1.5", 8989)
        val browser = ScriptedBridgeHostBrowser(resultsPerAttempt = listOf(emptyList(), listOf(host)))
        val discovery = HakkaBridgeDiscovery(browser, timeoutMs = 20L)

        val selection = awaitSelection(discovery)

        assertEquals(BridgeDiscoverySelection.AutoConnect(host), selection)
        assertEquals(2, browser.startCallCount, "the single host was only found on the retry attempt")
    }

    @Test
    fun `many hosts are ambiguous and connect to none`() {
        val a = DiscoveredBridgeHost("192.168.1.5", 8989)
        val b = DiscoveredBridgeHost("192.168.1.6", 8989)
        val browser = ScriptedBridgeHostBrowser(resultsPerAttempt = listOf(listOf(a, b)))
        val discovery = HakkaBridgeDiscovery(browser, timeoutMs = 20L)

        val selection = awaitSelection(discovery)

        assertEquals(BridgeDiscoverySelection.Ambiguous(listOf(a, b)), selection)
    }

    @Test
    fun `retry is skipped when retryOnEmptyResult is disabled`() {
        val browser = ScriptedBridgeHostBrowser(resultsPerAttempt = listOf(emptyList(), emptyList()))
        val discovery = HakkaBridgeDiscovery(browser, timeoutMs = 20L, retryOnEmptyResult = false)

        val selection = awaitSelection(discovery)

        assertEquals(BridgeDiscoverySelection.None, selection)
        assertEquals(1, browser.startCallCount, "retry must not run when disabled")
    }

    @Test
    fun `stop before the timeout never fires onSelection`() {
        val browser = ScriptedBridgeHostBrowser(resultsPerAttempt = listOf(emptyList()))
        val discovery = HakkaBridgeDiscovery(browser, timeoutMs = 50L)

        var fired = false
        discovery.start { fired = true }
        discovery.stop()

        Thread.sleep(150)
        assertTrue(!fired, "onSelection must not fire once stopped")
    }

    /**
     * MINOR regression: a plain `AtomicBoolean settled` flag let the scheduled timeout
     * task's check-then-act (`if (settled.get()) return; ...; settled.set(true)`) race a
     * concurrent [HakkaBridgeDiscovery.stop] — `stop()` could win its own CAS believing it
     * suppressed the outcome, while the timeout task had already passed its `settled.get()`
     * read and went on to fire `onSelection` anyway. `browser.stop()` is called by the
     * timeout task *before* that settle check, so triggering `discovery.stop()` reentrantly
     * from a scripted browser's `stop()` reproduces the exact interleaving deterministically
     * — no real-time race needed to hit the window.
     */
    @Test
    fun `stop racing the timeout task's own settle check fires nothing`() {
        val host = DiscoveredBridgeHost("192.168.1.5", 8989)
        val browser = object : BridgeHostBrowser {
            var onStop: (() -> Unit)? = null

            override fun start(onHostsChanged: (List<DiscoveredBridgeHost>) -> Unit) {
                onHostsChanged(listOf(host))
            }

            override fun stop() {
                onStop?.invoke()
            }
        }
        val discovery = HakkaBridgeDiscovery(browser, timeoutMs = 20L)

        var fired = false
        browser.onStop = { discovery.stop() }
        discovery.start { fired = true }

        Thread.sleep(200)
        assertTrue(!fired, "onSelection must not fire when stop() races the timeout task's own settle check")
    }
}

class HakkaInterceptorConnectBridgeTest {
    @Test
    fun `connectBridge attaches a sink and closes cleanly`() {
        val closed = CountDownLatch(1)
        val server = MockWebServer()
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(webSocket: okhttp3.WebSocket, response: okhttp3.Response) {
                        // Close from the server side immediately — mirrors BridgeSinkTest's
                        // listeners. Without this, MockWebServer.shutdown() can hang waiting
                        // for its dispatcher queue to drain a still-open connection.
                        webSocket.close(1000, "done")
                    }

                    override fun onClosed(webSocket: okhttp3.WebSocket, code: Int, reason: String) {
                        closed.countDown()
                    }
                },
            ),
        )
        server.start()

        val interceptor = HakkaInterceptor { maxRequests = 10 }
        val wsUrl = server.url("/bridge").toString().replace("http://", "ws://")

        val connection = interceptor.connectBridge(wsUrl)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "server-side socket never closed")

        connection.close()
        interceptor.close()
        server.shutdown()
    }
}
