package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest

/**
 * No-op HAR exporter — returns empty HAR JSON.
 * Same API as [com.noodleapps.hakka.export.HarExporter].
 */
object HarExporter {
    fun export(requests: List<NetworkRequest>): String = """{"log":{"version":"1.2","creator":{"name":"Hakka","version":"0.1.0"},"entries":[]}}"""
}