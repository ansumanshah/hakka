package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Context
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.os.Build
import android.util.DisplayMetrics
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

/**
 * [SettingsActivity]'s read-only "Environment" section — device/app/locale/
 * screen/network diagnostics. Split out purely for file size; this was the
 * whole screen before Controls was added above it, kept in the same
 * Device/App/Locale/Screen/Network grouping the other three platforms use.
 */
internal fun buildInfoRows(activity: Activity, parent: LinearLayout) {
    addSection(activity, parent, "Device")
    addKV(activity, parent, "Manufacturer", Build.MANUFACTURER.replaceFirstChar { it.uppercase() })
    addKV(activity, parent, "Model", Build.MODEL)
    addKV(activity, parent, "Android", "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
    addKV(activity, parent, "Build", Build.DISPLAY)
    parent.addView(divider(activity))

    addSection(activity, parent, "App")
    try {
        val pi = activity.packageManager.getPackageInfo(activity.packageName, 0)
        addKV(activity, parent, "Package", activity.packageName)
        addKV(activity, parent, "Version", "${pi.versionName ?: "?"} (${versionCode(pi)})")
    } catch (_: Exception) {
        addKV(activity, parent, "Package", activity.packageName)
    }
    parent.addView(divider(activity))

    addSection(activity, parent, "Locale")
    val locale = Locale.getDefault()
    addKV(activity, parent, "Locale", locale.toString())
    addKV(activity, parent, "Language", locale.displayLanguage)
    addKV(activity, parent, "Country", locale.displayCountry.ifEmpty { "—" })
    parent.addView(divider(activity))

    addSection(activity, parent, "Screen")
    val dm = DisplayMetrics().also {
        @Suppress("DEPRECATION")
        activity.windowManager.defaultDisplay.getMetrics(it)
    }
    addKV(activity, parent, "Size", "${dm.widthPixels} × ${dm.heightPixels} px")
    addKV(activity, parent, "Density", "${dm.densityDpi} dpi (${densityBucket(dm.densityDpi)})")
    addKV(activity, parent, "Scale", "%.2f".format(dm.density))
    parent.addView(divider(activity))

    addSection(activity, parent, "Network")
    addKV(activity, parent, "Type", networkType(activity))
}

private fun addSection(activity: Activity, parent: LinearLayout, title: String) {
    parent.addView(TextView(activity).apply {
        text = title; textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(null, Typeface.BOLD)
        setTextColor(Theme.text(activity))
        setPadding(0, dp(activity.resources, Theme.s10), 0, dp(activity.resources, Theme.s4))
    })
}

private fun addKV(activity: Activity, parent: LinearLayout, key: String, value: String) {
    parent.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, dp(activity.resources, GeneratedMetrics.Spacing.xxs), 0, dp(activity.resources, GeneratedMetrics.Spacing.xxs))
        // Key column shrinks to fit its content — no fixed width.
        addView(TextView(activity).apply {
            text = key; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.textSecondary(activity))
            layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                setMargins(0, 0, dp(activity.resources, Theme.s8), 0)
            }
        })
        addView(TextView(activity).apply {
            text = value; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
            setTextColor(Theme.text(activity))
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
    })
}

@Suppress("DEPRECATION")
private fun versionCode(pi: android.content.pm.PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode
    else pi.versionCode.toLong()

private fun densityBucket(dpi: Int): String = when {
    dpi <= 120 -> "ldpi"
    dpi <= 160 -> "mdpi"
    dpi <= 240 -> "hdpi"
    dpi <= 320 -> "xhdpi"
    dpi <= 480 -> "xxhdpi"
    else -> "xxxhdpi"
}

/** Network type without any dangerous permissions. ConnectivityManager.activeNetworkInfo is
 *  available on API 21+ without READ_PHONE_STATE. Deprecated in API 29 but still functional. */
@Suppress("DEPRECATION")
private fun networkType(activity: Activity): String {
    return try {
        val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return "Unknown"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return "None"
            val caps = cm.getNetworkCapabilities(network) ?: return "Unknown"
            when {
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "Cellular"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
                else -> "Other"
            }
        } else {
            cm.activeNetworkInfo?.typeName ?: "None"
        }
    } catch (_: Exception) {
        "Unknown"
    }
}
