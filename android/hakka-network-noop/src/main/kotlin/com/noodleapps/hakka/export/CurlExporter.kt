package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest

/**
 * No-op cURL exporter — returns empty string.
 * Same API as [com.noodleapps.hakka.export.CurlExporter].
 */
object CurlExporter {
    fun export(request: NetworkRequest): String = ""
}