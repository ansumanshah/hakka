package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest

/**
 * No-op Postman exporter — returns an empty Postman Collection v2.1 JSON.
 * Same API as [com.noodleapps.hakka.export.PostmanExporter].
 */
object PostmanExporter {
    fun export(requests: List<NetworkRequest>, name: String = "Hakka Export"): String =
        """{"info":{"name":"$name","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[]}"""
}
