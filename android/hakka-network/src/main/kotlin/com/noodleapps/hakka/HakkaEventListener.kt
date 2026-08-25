package com.noodleapps.hakka

import okhttp3.Call
import okhttp3.EventListener
import okhttp3.Handshake
import okhttp3.Protocol
import okhttp3.Response
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.ConcurrentHashMap

/**
 * OkHttp [EventListener] that captures timing milestones for each call.
 *
 * Tracks DNS, TLS, connect, TTFB, download durations, TLS detail, and protocol per-call.
 * Timing data is stored in a concurrent map keyed by the [Call] object itself (identity).
 * [HakkaInterceptor] reads a snapshot via [Factory.peek] when it builds the initial
 * [NetworkRequest] — for a response peeked only up to `maxBodySize`, [TimingData.downloadMs]
 * isn't known yet at that point, since the body hasn't finished streaming. It then registers
 * [Factory.onCallComplete] to queue a patch for the record once this listener's [callEnd]/
 * [callFailed] observes the real finish (see those methods' doc for why). That callback fires
 * on whatever thread drains the response body — unrelated to CaptureProcessor's own worker
 * thread — so the patch itself is submitted to CaptureProcessor rather than applied directly
 * here; see [HakkaInterceptor.schedulePatchDownloadTiming] and `CaptureProcessor.enqueuePatch`
 * for why that ordering matters.
 */
class HakkaEventListener private constructor(
    private val timings: ConcurrentHashMap<Call, TimingData>,
    private val completionHandlers: ConcurrentHashMap<Call, (TimingData) -> Unit>,
) : EventListener() {

    /** Timing milestones captured during a call. All time values in epoch ms. */
    data class TimingData(
        var dnsStartMs: Long = 0,
        var dnsEndMs: Long = 0,
        var connectStartMs: Long = 0,
        var connectEndMs: Long = 0,
        var secureConnectStartMs: Long = 0,
        var secureConnectEndMs: Long = 0,
        var requestHeadersEndMs: Long = 0,
        var responseHeadersStartMs: Long = 0,
        var responseBodyEndMs: Long = 0,
        var redirectCount: Int = 0,
        var redirectUrls: MutableList<String> = mutableListOf(),
        var tlsVersion: String? = null,
        var cipherSuite: String? = null,
        var protocol: String? = null,
    ) {
        val dnsMs: Long? get() = if (dnsEndMs > dnsStartMs) dnsEndMs - dnsStartMs else null
        val connectMs: Long? get() = if (connectEndMs > connectStartMs) connectEndMs - connectStartMs else null
        val tlsMs: Long? get() = if (secureConnectEndMs > secureConnectStartMs) secureConnectEndMs - secureConnectStartMs else null
        val ttfbMs: Long? get() = if (responseHeadersStartMs > 0 && requestHeadersEndMs > 0) responseHeadersStartMs - requestHeadersEndMs else null
        val downloadMs: Long? get() = if (responseBodyEndMs > 0 && responseHeadersStartMs > 0) responseBodyEndMs - responseHeadersStartMs else null
    }

    override fun dnsStart(call: Call, domainName: String) {
        getOrCreate(call).dnsStartMs = now()
    }

    override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
        getOrCreate(call).dnsEndMs = now()
    }

    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
        getOrCreate(call).connectStartMs = now()
    }

    override fun connectEnd(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?) {
        val data = getOrCreate(call)
        data.connectEndMs = now()
        data.protocol = protocol?.toString()
    }

    override fun secureConnectStart(call: Call) {
        getOrCreate(call).secureConnectStartMs = now()
    }

    override fun secureConnectEnd(call: Call, handshake: Handshake?) {
        val data = getOrCreate(call)
        data.secureConnectEndMs = now()
        handshake?.let {
            try {
                data.tlsVersion = it.tlsVersion.javaName
                data.cipherSuite = it.cipherSuite.javaName
            } catch (_: Exception) {}
        }
    }

    override fun requestHeadersEnd(call: Call, request: okhttp3.Request) {
        getOrCreate(call).requestHeadersEndMs = now()
    }

    override fun responseHeadersStart(call: Call) {
        getOrCreate(call).responseHeadersStartMs = now()
    }

    override fun responseBodyEnd(call: Call, byteCount: Long) {
        getOrCreate(call).responseBodyEndMs = now()
    }

    override fun connectFailed(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?, ioe: IOException) {
        getOrCreate(call).connectEndMs = now()
    }

    override fun responseFailed(call: Call, ioe: IOException) {
        getOrCreate(call).responseBodyEndMs = now()
    }

    override fun callEnd(call: Call) {
        // The call is truly done here — the body (if any) has been fully read or closed,
        // so responseBodyEnd already ran and TimingData.downloadMs is final. Notify whoever
        // registered onCallComplete (the interceptor, patching a large-body capture whose
        // initial snapshot predated this) before dropping the entry; a call nobody registered
        // for just falls through to cleanup, same as before.
        val data = timings.remove(call)
        if (data != null) completionHandlers.remove(call)?.invoke(data)
    }

    override fun callFailed(call: Call, ioe: IOException) {
        // Same finish notification as callEnd, for the failed/cancelled path.
        val data = timings.remove(call)
        if (data != null) completionHandlers.remove(call)?.invoke(data)
    }

    override fun responseHeadersEnd(call: Call, response: Response) {
        if (response.isRedirect) {
            val data = getOrCreate(call)
            data.redirectCount++
            response.header("Location")?.let { data.redirectUrls.add(it) }
        }
    }

    private fun getOrCreate(call: Call): TimingData =
        timings.getOrPut(call) { TimingData() }

    private fun now(): Long = System.currentTimeMillis()

    /** Factory that shares a timing map with [HakkaInterceptor]. */
    class Factory : EventListener.Factory {
        internal val timings = ConcurrentHashMap<Call, TimingData>()
        private val completionHandlers = ConcurrentHashMap<Call, (TimingData) -> Unit>()

        override fun create(call: Call): EventListener =
            HakkaEventListener(timings, completionHandlers)

        /**
         * Non-destructive snapshot of the current timing data for [call]. Safe to call
         * before the call has finished — milestones not yet reached are simply absent
         * from the snapshot (see [TimingData]'s nullable getters). Returns null once the
         * call has already finished and [callEnd]/[callFailed] cleaned the entry up.
         */
        fun peek(call: Call): TimingData? = timings[call]?.copy()

        /**
         * Registers [onComplete] to run exactly once, from [callEnd] or [callFailed], with
         * the call's final [TimingData] — the point at which [TimingData.downloadMs] is
         * guaranteed accurate even for a response whose body was only peeked up to
         * `maxBodySize` at capture time. No-op if [call] has already finished by the time
         * this is registered (nothing left to patch).
         */
        fun onCallComplete(call: Call, onComplete: (TimingData) -> Unit) {
            if (timings.containsKey(call)) completionHandlers[call] = onComplete
        }
    }
}
