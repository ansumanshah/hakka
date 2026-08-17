package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest

/**
 * No-op text exporter — returns empty string.
 * Same API as [com.noodleapps.hakka.export.TextExporter].
 */
object TextExporter {
    fun export(request: NetworkRequest): String = ""
    fun export(requests: List<NetworkRequest>): String = ""
}
