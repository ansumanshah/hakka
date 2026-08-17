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
 * Timing data is stored in a concurrent map keyed by the [Call] object itself (identity),
 * and consumed by [HakkaInterceptor] when building [NetworkRequest].
 */
class HakkaEventListener private constructor(
    private val timings: ConcurrentHashMap<Call, TimingData>,
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
        // Clean up timing data for completed calls not consumed by the interceptor.
        // This handles the normal case where the interceptor already consumed it (no-op remove),
        // and the edge case where timing data was orphaned.
        timings.remove(call)
    }

    override fun callFailed(call: Call, ioe: IOException) {
        // Clean up timing data on failed/cancelled calls to prevent memory leaks.
        timings.remove(call)
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

        override fun create(call: Call): EventListener =
            HakkaEventListener(timings)

        /** Consume and remove timing data for a call. */
        fun consume(call: Call): TimingData? =
            timings.remove(call)
    }
}
