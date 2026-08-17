package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest
import org.json.JSONArray
import org.json.JSONObject

/**
 * Builds a multi-format report from a list of [NetworkRequest] objects.
 * Produces HAR, human-readable text, and compact JSON suitable for Sentry breadcrumbs.
 */
object ReportBuilder {

    data class Report(
        val har: String,
        val text: String,
        val json: String,
        val deviceInfo: DeviceInfo,
        val requestCount: Int,
        val timeRangeStart: Long?,
        val timeRangeEnd: Long?,
    )

    data class DeviceInfo(
        val osVersion: String = "",
        val deviceModel: String = "",
        val appVersion: String = "",
        val appPackageName: String = "",
    )

    /** Builds a report containing HAR, text, and compact JSON representations. */
    fun build(requests: List<NetworkRequest>, deviceInfo: DeviceInfo = DeviceInfo()): Report {
        val sorted = requests.sortedBy { it.startTimeMs }
        return Report(
            har = HarExporter.export(sorted),
            text = TextExporter.export(sorted),
            json = buildCompactJson(sorted),
            deviceInfo = deviceInfo,
            requestCount = requests.size,
            timeRangeStart = sorted.firstOrNull()?.startTimeMs,
            timeRangeEnd = sorted.lastOrNull()?.startTimeMs,
        )
    }

    /**
     * Compact JSON array — method, url path, status, duration, error.
     * No bodies or headers — suitable for Sentry breadcrumbs.
     */
    private fun buildCompactJson(requests: List<NetworkRequest>): String {
        val arr = JSONArray()
        for (req in requests) {
            arr.put(JSONObject().apply {
                put("method", req.method.name)
                put("url", extractPath(req.url))
                put("status", req.status ?: JSONObject.NULL)
                put("duration", req.durationMs ?: JSONObject.NULL)
                if (req.error != null) put("error", req.error)
            })
        }
        return arr.toString()
    }

    private fun extractPath(url: String): String = try {
        val idx = url.indexOf("://")
        if (idx < 0) url
        else {
            val afterScheme = url.substring(idx + 3)
            val pathStart = afterScheme.indexOf('/')
            if (pathStart < 0) "/" else afterScheme.substring(pathStart)
        }
    } catch (_: Exception) {
        url
    }
}
