package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import com.noodleapps.hakka.NetworkRecord
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.OtelExportOptions
import com.noodleapps.hakka.export.CurlExporter
import com.noodleapps.hakka.export.OkHttpExporter
import com.noodleapps.hakka.export.PostmanExporter
import com.noodleapps.hakka.export.ReportBuilder
import com.noodleapps.hakka.export.TextExporter
import com.noodleapps.hakka.toOtelJson
import java.io.File

internal enum class ComposeNetworkAction(val label: String) {
    COPY_CURL("Copy cURL"),
    COPY_OKHTTP("Copy as OkHttp"),
    COPY_URL("Copy URL"),
    SHARE_TEXT("Share as text"),
    EXPORT_POSTMAN("Export Postman"),
    EXPORT_OTEL("Export OTel JSON"),
}

internal enum class ComposeBatchExport(val label: String) {
    HAR("Export HAR"),
    OTEL("Export OTel JSON"),
}

internal fun runNetworkAction(activity: Activity, request: NetworkRequest, action: ComposeNetworkAction) {
    when (action) {
        ComposeNetworkAction.COPY_CURL -> copyNetworkText(activity, "cURL", CurlExporter.export(request))
        ComposeNetworkAction.COPY_OKHTTP -> copyNetworkText(activity, "OkHttp code", OkHttpExporter.export(request))
        ComposeNetworkAction.COPY_URL -> copyNetworkText(activity, "URL", request.url)
        ComposeNetworkAction.SHARE_TEXT -> activity.startActivity(Intent.createChooser(
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, TextExporter.export(request))
            }, "Share request",
        ))
        ComposeNetworkAction.EXPORT_POSTMAN -> activity.startActivity(Intent.createChooser(
            Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_TEXT, PostmanExporter.export(listOf(request)))
                putExtra(Intent.EXTRA_SUBJECT, "Postman Collection")
            }, "Export Postman Collection",
        ))
        ComposeNetworkAction.EXPORT_OTEL -> shareNetworkOtel(activity, listOf(request))
    }
}

internal fun shareNetworkBatch(activity: Activity, requests: List<NetworkRequest>, export: ComposeBatchExport) {
    if (requests.isEmpty()) {
        Toast.makeText(activity, "No requests selected", Toast.LENGTH_SHORT).show()
        return
    }
    when (export) {
        ComposeBatchExport.HAR -> shareNetworkHar(activity, requests)
        ComposeBatchExport.OTEL -> shareNetworkOtel(activity, requests)
    }
}

private fun shareNetworkHar(activity: Activity, requests: List<NetworkRequest>) {
    val info = ReportBuilder.DeviceInfo(
        osVersion = android.os.Build.VERSION.RELEASE,
        deviceModel = android.os.Build.MODEL,
        appVersion = try {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: ""
        } catch (_: Exception) { "" },
        appPackageName = activity.packageName,
    )
    val report = ReportBuilder.build(requests, info)
    val file = File(networkExportsDir(activity), "hakka-report.har").apply { writeText(report.har) }
    shareNetworkFile(activity, file, "Hakka Report (${report.requestCount} requests)", "Share report", report.text)
}

private fun shareNetworkOtel(activity: Activity, requests: List<NetworkRequest>) {
    val json = requests.map(NetworkRecord::from)
        .toOtelJson(OtelExportOptions(serviceName = activity.packageName)).toString(2)
    val file = File(networkExportsDir(activity), "hakka-otel.json").apply { writeText(json) }
    shareNetworkFile(activity, file, "Hakka OTel Export (${requests.size} requests)", "Share OTel export")
}

private fun shareNetworkFile(activity: Activity, file: File, subject: String, chooser: String, text: String? = null) {
    activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
        type = "application/json"
        putExtra(Intent.EXTRA_STREAM, networkFileUri(activity, file))
        putExtra(Intent.EXTRA_SUBJECT, subject)
        if (text != null) putExtra(Intent.EXTRA_TEXT, text)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }, chooser))
}

private fun networkExportsDir(activity: Activity): File =
    File(activity.cacheDir, "hakka-exports").apply { mkdirs() }

private fun networkFileUri(activity: Activity, file: File): Uri =
    FileProvider.getUriForFile(activity, "${activity.packageName}.hakka.fileprovider", file)

private fun copyNetworkText(activity: Activity, label: String, text: String) {
    val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    Toast.makeText(activity, "$label copied", Toast.LENGTH_SHORT).show()
}
