package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * A [RecordSink] that streams every [NetworkRecord] to the Hakka desktop bridge hub
 * over a WebSocket connection. The hub protocol is:
 * ```json
 * { "type": "request", "payload": <NetworkRequest as JSON> }
 * ```
 *
 * Behaviour:
 * - Connects to [bridgeUrl] immediately on construction.
 * - While disconnected, enqueues frames in a bounded in-memory buffer
 *   ([QUEUE_CAPACITY] frames). Oldest frames are dropped when the buffer is full.
 * - Reconnects with exponential backoff (1 s → 2 s → 4 s … capped at [MAX_BACKOFF_MS]).
 * - Only [NetworkRecord] records are forwarded; other [ContractRecord] subtypes are ignored.
 * - [close] stops reconnection and closes the active WebSocket.
 *
 * Inbound control frames: the hub also relays `{ "type": "control", "payload": ControlCommand }`
 * frames peer-to-peer (e.g. hakka mcp's `create_mock` / `set_throttle` write tools). Every
 * inbound text frame is parsed with [parseControlCommand] (strict, never throws) and, if
 * valid, applied with [applyControlCommand] (fail-open — an engine throw is caught and never
 * propagates). Non-control frames and malformed JSON are dropped silently.
 *
 * This class is isolated from capture logic — install it as a sink on [HakkaInterceptor]
 * or [RecordSinkHub]; it receives fully-redacted, processed records.
 */
internal class BridgeSink(
    private val bridgeUrl: String,
    private val httpClient: OkHttpClient = OkHttpClient(),
) : RecordSink, AutoCloseable {

    private companion object {
        const val QUEUE_CAPACITY = 500
        const val INITIAL_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 30_000L
    }

    // Pending frames while the socket is disconnected.
    private val queue = ArrayBlockingQueue<String>(QUEUE_CAPACITY)

    // Null when disconnected; non-null when the handshake completed.
    private val socket = AtomicReference<WebSocket?>(null)

    private val closed = AtomicBoolean(false)
    private val backoffMs = AtomicInteger(INITIAL_BACKOFF_MS.toInt())

    private val scheduler: ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "HakkaBridgeSink").apply { isDaemon = true }
        }

    private var reconnectFuture: ScheduledFuture<*>? = null

    init {
        connect()
    }

    override fun onRecord(record: ContractRecord) {
        if (closed.get()) return
        if (record !is NetworkRecord) return

        val frame = buildFrame(record)
        val ws = socket.get()
        if (ws != null) {
            val sent = ws.send(frame)
            if (!sent) {
                // Socket closed mid-send — buffer it for the next connection.
                enqueue(frame)
            }
        } else {
            enqueue(frame)
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        reconnectFuture?.cancel(false)
        socket.getAndSet(null)?.close(1000, "BridgeSink closed")
        scheduler.shutdown()
    }

    // ---- Private helpers ----

    private fun buildFrame(record: NetworkRecord): String =
        JSONObject()
            .put("type", "request")
            .put("payload", record.request.toJson())
            .toString()

    private fun enqueue(frame: String) {
        // Discard oldest if full to bound memory use.
        if (!queue.offer(frame)) {
            queue.poll()
            queue.offer(frame)
        }
    }

    private fun connect() {
        if (closed.get()) return
        val request = Request.Builder().url(bridgeUrl).build()
        httpClient.newWebSocket(request, Listener())
    }

    private fun scheduleReconnect() {
        if (closed.get()) return
        val delay = backoffMs.get().toLong()
        reconnectFuture = scheduler.schedule(::connect, delay, TimeUnit.MILLISECONDS)
        // Double backoff, cap at MAX_BACKOFF_MS.
        backoffMs.updateAndGet { current ->
            minOf((current * 2L).coerceAtMost(Int.MAX_VALUE.toLong()), MAX_BACKOFF_MS).toInt()
        }
    }

    private inner class Listener : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (closed.get()) {
                webSocket.close(1000, "BridgeSink closed")
                return
            }
            socket.set(webSocket)
            backoffMs.set(INITIAL_BACKOFF_MS.toInt())

            // Drain buffered frames in arrival order.
            var frame = queue.poll()
            while (frame != null) {
                if (!webSocket.send(frame)) break
                frame = queue.poll()
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            socket.compareAndSet(webSocket, null)
            scheduleReconnect()
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            // Acknowledge the server-initiated close handshake so onClosed fires promptly
            // instead of waiting on OkHttp's read timeout.
            webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            socket.compareAndSet(webSocket, null)
            if (!closed.get()) {
                scheduleReconnect()
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            handleInboundFrame(text)
        }
    }
}

/**
 * Parses an inbound bridge text frame and, if it is a valid `{ type: "control", payload }`
 * frame, applies the resulting [ControlCommand] to the engine singletons.
 *
 * Hard invariant: never throws. Any parse failure (malformed JSON, wrong `type`, unknown
 * `kind`, hostile shape) is dropped silently — mirrors `HakkaBridge._handleMessage` on RN.
 * Package-visible (not private) so tests can drive it directly without a live socket.
 */
internal fun handleInboundFrame(text: String) {
    val envelope = try {
        JSONObject(text)
    } catch (_: Exception) {
        return
    }

    val type = envelope.opt("type") as? String ?: return
    if (type != "control") return

    val payload = envelope.opt("payload") as? JSONObject ?: return
    val cmd = parseControlCommand(payload) ?: return
    applyControlCommand(cmd)
}
