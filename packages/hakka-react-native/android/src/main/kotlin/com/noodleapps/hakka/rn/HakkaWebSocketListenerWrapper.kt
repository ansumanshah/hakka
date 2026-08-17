package com.noodleapps.hakka.rn

import android.util.Base64
import com.noodleapps.hakka.HttpMethod
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.RequestSource
import com.noodleapps.hakka.WsMessage
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Wraps a [WebSocketListener] to capture per-frame payloads and emit a
 * [NetworkRequest] via the active Hakka interceptor when the connection closes.
 *
 * ### Frame capture
 * - Text frames: stored verbatim.
 * - Binary frames ≤ [WsMessage.BINARY_CAP_BYTES] (32 KB): base-64 encoded.
 * - Binary frames > cap: size recorded, payload discarded (`data=null`, `binary=true`).
 * - The negotiated sub-protocol is read from the HTTP 101 response and stored as
 *   [NetworkRequest.wsProtocol].
 *
 * ### Outbound (sent) frame capture
 * OkHttp delivers the [WebSocket] handle (returned by [okhttp3.OkHttpClient.newWebSocket])
 * directly to the React Native `WebSocketModule` — there is no standard OkHttp hook that
 * intercepts `WebSocket.send()` calls without either subclassing `OkHttpClient` (impossible:
 * the constructor is `internal` in okhttp3) or patching RN's native module.  For this reason,
 * outbound frames are captured **best-effort** via [recordSentText] and [recordSentBytes]:
 * these methods are public so that an app-layer shim or a custom RN `WebSocketModule`
 * subclass can forward send calls for capture.
 *
 * For standalone (non-RN) Android apps, use [com.noodleapps.hakka.HakkaWebSocketWrapper]
 * from the `hakka-network` module, which captures both directions transparently.
 *
 * ### Dedup strategy
 * We dedup by url + start-time within a ±50 ms window tracked in [activeConnections]
 * to avoid double-counting if the same URL is opened from multiple callers.
 *
 * Usage: install via [HakkaOkHttpClientFactory] which passes each new WebSocket
 * listener through [wrap] before handing it to OkHttp.
 */
internal class HakkaWebSocketListenerWrapper private constructor(
    private val delegate: WebSocketListener?,
    private val url: String,
    private val startTime: Long,
) : WebSocketListener() {

    private val messageCount = AtomicInteger(0)
    private val emitted = AtomicBoolean(false)
    private val frames = CopyOnWriteArrayList<WsMessage>()
    private val negotiatedProtocol = AtomicReference<String?>(null)

    companion object {
        /** Active WS start-times keyed by url, for ±50 ms dedup. */
        private val activeConnections = ConcurrentHashMap<String, Long>()
        private const val DEDUP_WINDOW_MS = 50L

        /**
         * Returns a [HakkaWebSocketListenerWrapper] wrapping [delegate] when Hakka
         * capture is active and no duplicate connection to [url] was started within
         * [DEDUP_WINDOW_MS].  Returns [delegate] unchanged when capture is disabled
         * or a duplicate is detected.
         */
        fun wrap(delegate: WebSocketListener?, url: String): WebSocketListener? {
            // Guard: only wrap when hakka-network is on classpath
            if (NativeCoreDelegate.currentInterceptorPublic() == null) return delegate

            val now = System.currentTimeMillis()
            val existing = activeConnections[url]
            if (existing != null && (now - existing) < DEDUP_WINDOW_MS) {
                return delegate  // duplicate — pass through unwrapped
            }
            activeConnections[url] = now
            return HakkaWebSocketListenerWrapper(delegate, url, now)
        }
    }

    // -- WebSocketListener overrides --

    override fun onOpen(webSocket: WebSocket, response: Response) {
        // Capture the negotiated sub-protocol from the handshake response.
        // OkHttp surfaces it via the `Sec-WebSocket-Protocol` response header.
        val proto = response.header("Sec-WebSocket-Protocol")
            ?.trim()?.takeIf { it.isNotEmpty() }
        negotiatedProtocol.set(proto)
        delegate?.onOpen(webSocket, response)
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        messageCount.incrementAndGet()
        frames.add(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = false,
                data = text,
                size = text.length.toLong(),
                binary = false,
            )
        )
        delegate?.onMessage(webSocket, text)
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        messageCount.incrementAndGet()
        val size = bytes.size.toLong()
        val encodedData = if (bytes.size <= WsMessage.BINARY_CAP_BYTES) {
            Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
        } else {
            null
        }
        frames.add(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = false,
                data = encodedData,
                size = size,
                binary = true,
            )
        )
        delegate?.onMessage(webSocket, bytes)
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        delegate?.onClosing(webSocket, code, reason)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        emitCapture(wsCloseCode = code, error = null)
        delegate?.onClosed(webSocket, code, reason)
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        emitCapture(wsCloseCode = 1006 /* abnormal closure per RFC 6455 */, error = t.message)
        delegate?.onFailure(webSocket, t, response)
    }

    // -- Private --

    /**
     * Records an outbound text frame.
     *
     * Call this from an app-layer shim or a custom `WebSocketModule` subclass immediately
     * before (or after) calling the real `WebSocket.send(text)`.  Frames recorded here
     * appear in the Frames tab alongside inbound frames captured automatically.
     */
    internal fun recordSentText(text: String) {
        frames.add(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = true,
                data = text,
                size = text.length.toLong(),
                binary = false,
            )
        )
    }

    internal fun recordSentBytes(bytes: ByteString) {
        val size = bytes.size.toLong()
        val encodedData = if (bytes.size <= WsMessage.BINARY_CAP_BYTES) {
            Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
        } else {
            null
        }
        frames.add(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = true,
                data = encodedData,
                size = size,
                binary = true,
            )
        )
    }

    private fun emitCapture(wsCloseCode: Int, error: String?) {
        if (!emitted.compareAndSet(false, true)) return
        activeConnections.remove(url)

        val interceptor = NativeCoreDelegate.currentInterceptorPublic() ?: return
        val now = System.currentTimeMillis()

        try {
            val capturedFrames = frames.toList()
            val request = NetworkRequest(
                id = UUID.randomUUID().toString(),
                url = url,
                method = HttpMethod.GET,
                status = if (wsCloseCode == 1000) 101 else null,
                startTimeMs = startTime,
                durationMs = now - startTime,
                requestHeaders = emptyMap(),
                responseHeaders = emptyMap(),
                requestBodySize = 0L,
                responseBodySize = 0L,
                requestBody = null,
                responseBody = null,
                error = error,
                source = RequestSource.NATIVE_WS,
                wsMessageCount = messageCount.get(),
                wsCloseCode = wsCloseCode,
                wsMessages = capturedFrames,
                wsProtocol = negotiatedProtocol.get(),
            )
            interceptor.logStore.add(request)
        } catch (_: Exception) {
            // SDK must never crash host app
        }
    }
}
