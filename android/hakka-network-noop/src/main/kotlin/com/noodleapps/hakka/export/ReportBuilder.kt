package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest

/**
 * No-op report builder — returns report with empty strings.
 * Same API as [com.noodleapps.hakka.export.ReportBuilder].
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

    fun build(requests: List<NetworkRequest>, deviceInfo: DeviceInfo = DeviceInfo()): Report = Report(
        har = "",
        text = "",
        json = "",
        deviceInfo = deviceInfo,
        requestCount = 0,
        timeRangeStart = null,
        timeRangeEnd = null,
    )
}
