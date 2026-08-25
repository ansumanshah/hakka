package com.noodleapps.hakka

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * A [WebSocket] proxy that records outbound frames (text + binary) sent by the caller,
 * and pairs with a [WebSocketListener] wrapper that records inbound frames from the server.
 * On connection close a [NetworkRequest] capturing all frames (sent + received) is stored
 * in the provided [LogStore].
 *
 * ### Usage (standalone Android app, no React Native)
 * ```kotlin
 * val interceptor = HakkaInterceptor { maxRequests = 500 }
 * val client = OkHttpClient.Builder()
 *     .addInterceptor(interceptor)
 *     .build()
 *
 * val capture = HakkaWebSocketWrapper.prepare(
 *     url      = "wss://example.com/ws",
 *     delegate = myListener,      // your existing WebSocketListener
 *     logStore = interceptor.logStore,
 * )
 * // Register the wrapping listener with OkHttp.
 * val rawWs: WebSocket = client.newWebSocket(request, capture.listener)
 * // Use capture.webSocket instead of rawWs for all send() calls.
 * capture.webSocket.send("hello")
 * ```
 *
 * ### Frame capture contract
 * - Text frames: stored verbatim.
 * - Binary frames ≤ [WsMessage.BINARY_CAP_BYTES] (32 KB): base-64 encoded.
 * - Binary frames > cap: size recorded, [WsMessage.data] = null, [WsMessage.binary] = true.
 * - Frame count is capped per connection (drop-oldest) — see `MAX_FRAMES`.
 *
 * ### Thread safety
 * [frames] uses [CopyOnWriteArrayList]; all other state is either atomic or written once
 * before the reference escapes. Safe to call send() from multiple threads.
 */
class HakkaWebSocketWrapper private constructor(
    private val url: String,
    private val startTimeMs: Long,
    private val logStore: LogStore,
) : WebSocket {

    /** The real OkHttp WebSocket, set on first [onOpen]. */
    private val socketRef = AtomicReference<WebSocket?>()

    private val frames = CopyOnWriteArrayList<WsMessage>()
    private val negotiatedProtocol = AtomicReference<String?>(null)
    private val emitted = AtomicBoolean(false)

    // ---- WebSocket interface ----

    override fun request(): Request = socketRef.get()?.request()
        ?: Request.Builder().url(url).build()

    override fun queueSize(): Long = socketRef.get()?.queueSize() ?: 0L

    override fun send(text: String): Boolean {
        recordFrame(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = true,
                data = text,
                size = text.length.toLong(),
                binary = false,
            )
        )
        return socketRef.get()?.send(text) ?: false
    }

    override fun send(bytes: ByteString): Boolean {
        val size = bytes.size.toLong()
        val encoded = if (bytes.size <= WsMessage.BINARY_CAP_BYTES) {
            java.util.Base64.getEncoder().encodeToString(bytes.toByteArray())
        } else null
        recordFrame(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = true,
                data = encoded,
                size = size,
                binary = true,
            )
        )
        return socketRef.get()?.send(bytes) ?: false
    }

    override fun close(code: Int, reason: String?): Boolean =
        socketRef.get()?.close(code, reason) ?: false

    override fun cancel() { socketRef.get()?.cancel() }

    // ---- Internal callbacks from the companion listener ----

    internal fun onOpen(webSocket: WebSocket, protocol: String?) {
        socketRef.compareAndSet(null, webSocket)
        negotiatedProtocol.set(protocol)
    }

    internal fun recordReceived(text: String) {
        recordFrame(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = false,
                data = text,
                size = text.length.toLong(),
                binary = false,
            )
        )
    }

    internal fun recordReceivedBytes(bytes: ByteString) {
        val size = bytes.size.toLong()
        val encoded = if (bytes.size <= WsMessage.BINARY_CAP_BYTES) {
            java.util.Base64.getEncoder().encodeToString(bytes.toByteArray())
        } else null
        recordFrame(
            WsMessage(
                timestampMs = System.currentTimeMillis(),
                sent = false,
                data = encoded,
                size = size,
                binary = true,
            )
        )
    }

    /**
     * Appends [frame] to [frames], then evicts the oldest frame(s) if the per-connection
     * cap ([MAX_FRAMES]) is crossed. [frames] is only drained on close/failure ([emit]), so
     * without a cap a long-lived, high-traffic socket would retain every frame's payload in
     * memory for the life of the connection — drop-oldest bounds that the same way
     * [LogStore]'s ring buffer bounds the overall request count.
     */
    private fun recordFrame(frame: WsMessage) {
        frames.add(frame)
        while (frames.size > MAX_FRAMES) {
            frames.removeAt(0)
        }
    }

    internal fun emit(wsCloseCode: Int, error: String?) {
        if (!emitted.compareAndSet(false, true)) return
        try {
            val capturedFrames = frames.toList()
            val sentCount = capturedFrames.count { it.sent }
            val now = System.currentTimeMillis()
            val record = NetworkRequest(
                id = UUID.randomUUID().toString(),
                url = url,
                method = HttpMethod.GET,
                status = if (wsCloseCode == 1000) 101 else null,
                startTimeMs = startTimeMs,
                durationMs = now - startTimeMs,
                requestHeaders = emptyMap(),
                responseHeaders = emptyMap(),
                requestBodySize = 0L,
                responseBodySize = 0L,
                requestBody = null,
                responseBody = null,
                error = error,
                source = RequestSource.NATIVE_WS,
                wsMessageCount = capturedFrames.size - sentCount,
                wsCloseCode = wsCloseCode,
                wsMessages = capturedFrames,
                wsProtocol = negotiatedProtocol.get(),
            )
            logStore.add(record)
        } catch (_: Exception) {
            // SDK must never crash host app
        }
    }

    // ---- Public API ----

    /**
     * Result of [prepare] — holds the wrapping [WebSocketListener] to pass to OkHttp and
     * the [HakkaWebSocketWrapper] to use for [WebSocket.send] calls.
     */
    class Prepared(
        /** Pass this to [okhttp3.OkHttpClient.newWebSocket]. */
        val listener: WebSocketListener,
        /** Use this instead of the raw [WebSocket] to capture outbound frames. */
        val webSocket: HakkaWebSocketWrapper,
    )

    companion object {
        /**
         * Per-connection cap on retained [frames] — see [recordFrame]. Generous enough
         * that ordinary sessions never hit it, but bounded so a long-lived high-traffic
         * socket can't grow [frames] without limit. Internal (not private) so tests can
         * assert against it directly rather than hardcoding the number.
         */
        internal const val MAX_FRAMES = 2_000

        /**
         * Prepares a capture pair for a single WebSocket connection.
         *
         * @param url       The WebSocket URL (stored as [NetworkRequest.url]).
         * @param delegate  Your existing [WebSocketListener]; may be null.
         * @param logStore  The [LogStore] that will receive the completed capture record.
         * @return          A [Prepared] holding the wrapping listener and the send-capturing socket.
         */
        fun prepare(
            url: String,
            delegate: WebSocketListener?,
            logStore: LogStore,
        ): Prepared {
            val wrapper = HakkaWebSocketWrapper(url, System.currentTimeMillis(), logStore)

            val listener = object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    val proto = response.header("Sec-WebSocket-Protocol")
                        ?.trim()?.takeIf { it.isNotEmpty() }
                    wrapper.onOpen(webSocket, proto)
                    delegate?.onOpen(webSocket, response)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    wrapper.recordReceived(text)
                    delegate?.onMessage(webSocket, text)
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    wrapper.recordReceivedBytes(bytes)
                    delegate?.onMessage(webSocket, bytes)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    delegate?.onClosing(webSocket, code, reason)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    wrapper.emit(code, null)
                    delegate?.onClosed(webSocket, code, reason)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    wrapper.emit(1006 /* abnormal closure per RFC 6455 */, t.message)
                    delegate?.onFailure(webSocket, t, response)
                }
            }

            return Prepared(listener, wrapper)
        }
    }
}
