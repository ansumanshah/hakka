package com.noodleapps.hakka

import okhttp3.Call
import okhttp3.EventListener

/**
 * No-op OkHttp [EventListener] — returns null from factory.
 * Same API as [com.noodleapps.hakka.HakkaEventListener].
 */
class HakkaEventListener private constructor() : EventListener() {

    class Factory : EventListener.Factory {
        override fun create(call: Call): EventListener = HakkaEventListener()

        fun consume(call: Call): TimingData? = null
    }

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
        val dnsMs: Long? get() = null
        val connectMs: Long? get() = null
        val tlsMs: Long? get() = null
        val ttfbMs: Long? get() = null
        val downloadMs: Long? get() = null
    }
}
