package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.util.DisplayMetrics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.util.Locale

/** Scrollable settings content, including read-only environment diagnostics. */
@Composable
internal fun SettingsContent(activity: Activity, interceptor: com.noodleapps.hakka.HakkaInterceptor?, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState())
            .padding(horizontal = GeneratedMetrics.Layout.gutter.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SettingsControls(activity, interceptor)
        HorizontalDivider()
        SettingsOverline("Environment")
        EnvironmentRows(activity)
    }
}

@Composable
internal fun SettingsOverline(title: String) {
    Text(
        text = title.uppercase(Locale.US),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun EnvironmentRows(activity: Activity) {
    val sections = environmentSections(activity)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        sections.forEachIndexed { index, (title, entries) ->
            if (index > 0) HorizontalDivider()
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                entries.forEach { (key, value) -> EnvironmentRow(key, value) }
            }
        }
    }
}

@Composable
private fun EnvironmentRow(key: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(key, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Text(
            value,
            modifier = Modifier.weight(1f).padding(start = 8.dp),
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun environmentSections(activity: Activity): List<Pair<String, List<Pair<String, String>>>> {
    val packageRows = try {
        val packageInfo = activity.packageManager.getPackageInfo(activity.packageName, 0)
        listOf("Package" to activity.packageName, "Version" to "${packageInfo.versionName ?: "?"} (${versionCode(packageInfo)})")
    } catch (_: Exception) {
        listOf("Package" to activity.packageName)
    }
    val displayMetrics = DisplayMetrics().also {
        @Suppress("DEPRECATION")
        activity.windowManager.defaultDisplay.getMetrics(it)
    }
    val locale = Locale.getDefault()
    return listOf(
        "Device" to listOf(
            "Manufacturer" to Build.MANUFACTURER.replaceFirstChar { it.uppercase() },
            "Model" to Build.MODEL,
            "Android" to "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
            "Build" to Build.DISPLAY,
        ),
        "App" to packageRows,
        "Locale" to listOf(
            "Locale" to locale.toString(),
            "Language" to locale.displayLanguage,
            "Country" to locale.displayCountry.ifEmpty { "—" },
        ),
        "Screen" to listOf(
            "Size" to "${displayMetrics.widthPixels} × ${displayMetrics.heightPixels} px",
            "Density" to "${displayMetrics.densityDpi} dpi (${densityBucket(displayMetrics.densityDpi)})",
            "Scale" to "%.2f".format(displayMetrics.density),
        ),
        "Network" to listOf("Type" to networkType(activity)),
    )
}

@Suppress("DEPRECATION")
private fun versionCode(packageInfo: android.content.pm.PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) packageInfo.longVersionCode else packageInfo.versionCode.toLong()

private fun densityBucket(dpi: Int): String = when {
    dpi <= 120 -> "ldpi"
    dpi <= 160 -> "mdpi"
    dpi <= 240 -> "hdpi"
    dpi <= 320 -> "xhdpi"
    dpi <= 480 -> "xxhdpi"
    else -> "xxxhdpi"
}

@Suppress("DEPRECATION")
private fun networkType(activity: Activity): String = try {
    val connectivity = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return "Unknown"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val network = connectivity.activeNetwork ?: return "None"
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return "Unknown"
        when {
            capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "Cellular"
            capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "Other"
        }
    } else {
        connectivity.activeNetworkInfo?.typeName ?: "None"
    }
} catch (_: Exception) {
    "Unknown"
}
