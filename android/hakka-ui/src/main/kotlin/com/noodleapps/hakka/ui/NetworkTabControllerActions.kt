package com.noodleapps.hakka.ui

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.TextView
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

// ── Selection mode ───────────────────────────────────────────────────

internal fun NetworkTabController.enterSelectionMode() {
    selectionMode = true; selectedIds.clear()
    buildSelectionTopBar(); applyFilters()
}

internal fun NetworkTabController.exitSelectionMode() {
    selectionMode = false; selectedIds.clear()
    buildNormalTopBar(); applyFilters()
}

internal fun NetworkTabController.toggleSelection(id: String) {
    if (selectedIds.contains(id)) selectedIds.remove(id) else selectedIds.add(id)
    buildSelectionTopBar()
}

// ── Pause / Resume ────────────────────────────────────────────────────

internal fun NetworkTabController.togglePause() {
    val logStore = HakkaUI.getInstance(activity).logStore ?: return
    if (logStore.isPaused) {
        logStore.resume()
        // Refresh list to show buffered requests that just flushed
        allRequests = (logStore.all()).reversed()
        rebuildFilterChips()
        applyFilters()
    } else {
        logStore.pause()
    }
    Haptics.light(activity)
    syncPausedState()
}

internal fun NetworkTabController.syncPausedState() {
    val paused = HakkaUI.getInstance(activity).logStore?.isPaused == true
    if (isPausedBannerReady()) {
        pausedBanner.visibility = if (paused) View.VISIBLE else View.GONE
    }
    topBarContainer.findViewWithTag<TextView>("pauseBtn")?.text = if (paused) "Resume" else "Pause"
}

// ── Actions ──────────────────────────────────────────────────────────

internal fun NetworkTabController.shareReport(requests: List<NetworkRequest>) {
    AlertDialog.Builder(activity)
        .setItems(arrayOf("Export HAR", "Export OTel JSON")) { _, which ->
            when (which) {
                0 -> shareHar(requests)
                1 -> shareOtel(requests)
            }
        }.show()
}

private fun NetworkTabController.shareHar(requests: List<NetworkRequest>) {
    val info = ReportBuilder.DeviceInfo(
        osVersion = android.os.Build.VERSION.RELEASE,
        deviceModel = android.os.Build.MODEL,
        appVersion = try {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: ""
        } catch (_: Exception) { "" },
        appPackageName = activity.packageName,
    )
    val report = ReportBuilder.build(requests, info)
    val file = File(exportsDir(), "hakka-report.har").apply { writeText(report.har) }
    activity.startActivity(Intent.createChooser(
        Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_STREAM, fileUri(file))
            putExtra(Intent.EXTRA_SUBJECT, "Hakka Report (${report.requestCount} requests)")
            putExtra(Intent.EXTRA_TEXT, report.text)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Share report"
    ))
}

/** Attached as a file, not EXTRA_TEXT — OTel payloads can exceed the Binder
 *  transaction limit and throw TransactionTooLargeException. */
private fun NetworkTabController.shareOtel(requests: List<NetworkRequest>) {
    val records = requests.map { NetworkRecord.from(it) }
    val json = records.toOtelJson(OtelExportOptions(serviceName = activity.packageName)).toString(2)
    val file = File(exportsDir(), "hakka-otel.json").apply { writeText(json) }
    activity.startActivity(Intent.createChooser(
        Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_STREAM, fileUri(file))
            putExtra(Intent.EXTRA_SUBJECT, "Hakka OTel Export (${requests.size} requests)")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Share OTel export"
    ))
}

/** Dedicated cache subdirectory backing the hakka_exports FileProvider path — never
 *  bare cacheDir. */
private fun NetworkTabController.exportsDir(): File = File(activity.cacheDir, "hakka-exports").apply { mkdirs() }

private fun NetworkTabController.fileUri(file: File): Uri =
    FileProvider.getUriForFile(activity, "${activity.packageName}.hakka.fileprovider", file)

internal fun NetworkTabController.clearRequests() {
    HakkaUI.getInstance(activity).logStore?.clear()
    allRequests = emptyList(); applyFilters()
}

internal fun NetworkTabController.showRowActions(r: NetworkRequest) {
    AlertDialog.Builder(activity)
        .setItems(arrayOf(
            "Copy cURL", "Copy as OkHttp", "Copy URL", "Share as text", "Export Postman", "Export OTel JSON",
        )) { _, which ->
            when (which) {
                0 -> copyToClipboard("cURL", CurlExporter.export(r))
                1 -> copyToClipboard("OkHttp code", OkHttpExporter.export(r))
                2 -> copyToClipboard("URL", r.url)
                3 -> activity.startActivity(Intent.createChooser(
                    Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"; putExtra(Intent.EXTRA_TEXT, TextExporter.export(r))
                    }, "Share request"))
                4 -> activity.startActivity(Intent.createChooser(
                    Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_TEXT, PostmanExporter.export(listOf(r)))
                        putExtra(Intent.EXTRA_SUBJECT, "Postman Collection")
                    }, "Export Postman Collection"))
                5 -> shareOtel(listOf(r))
            }
        }.show()
}

private fun NetworkTabController.copyToClipboard(label: String, text: String) {
    val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    Toast.makeText(activity, "$label copied", Toast.LENGTH_SHORT).show()
}
