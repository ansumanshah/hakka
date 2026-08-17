package com.noodleapps.hakka.ui

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.net.URL
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * HakkaNotificationManager — sticky ongoing notification with live stats and inbox.
 *
 * Shows an [Notification.InboxStyle] notification listing the last [INBOX_SIZE] requests
 * (method + status + path) with a summary line ("X requests, Y errors").
 * A one-tap "Clear" action dismisses the notification and resets counters.
 * Tap the notification body opens [HakkaActivity].
 *
 * Updates are debounced to 300 ms to avoid excessive cross-process IPC on busy apps.
 * Uses plain Android Notification.Builder (API 26+). Zero external dependencies.
 */
class HakkaNotificationManager(private val context: Context) {

    companion object {
        const val CHANNEL_ID = "hakka_network_logs"
        const val CHANNEL_NAME = "Network Logs"
        const val NOTIFICATION_ID = 1001
        const val INBOX_SIZE = 8

        const val ACTION_OPEN = "com.noodleapps.hakka.OPEN"
        const val ACTION_CLEAR = "com.noodleapps.hakka.CLEAR"

        private val TIME_FORMAT = object : ThreadLocal<SimpleDateFormat>() {
            override fun initialValue(): SimpleDateFormat =
                SimpleDateFormat("HH:mm:ss", Locale.US)
        }
    }

    private val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

    private val requestCount = AtomicInteger(0)
    private val errorCount = AtomicInteger(0)
    private val handler = Handler(Looper.getMainLooper())
    private val pendingUpdate = AtomicBoolean(false)

    // Inbox line list — guarded by inboxLock
    private val inboxLock = ReentrantReadWriteLock()
    private val inboxLines: ArrayDeque<String> = ArrayDeque(INBOX_SIZE + 1)

    init {
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Live network request log"
                setShowBadge(false)
            }
            notificationManager?.createNotificationChannel(channel)
        }
    }

    /** Check if we have notification permission (API 33+ requires runtime grant). */
    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return context.checkPermission(
            Manifest.permission.POST_NOTIFICATIONS,
            android.os.Process.myPid(),
            android.os.Process.myUid(),
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Record a captured request and add a line to the inbox.
     * Debounced — posts notification at most once per 300 ms to avoid
     * excessive cross-process IPC on high-traffic apps.
     * Thread-safe — called from OkHttp dispatcher threads.
     *
     * @param method  HTTP method string (e.g. "GET")
     * @param status  HTTP status code, or null if in-flight / network error
     * @param url     full URL (host + path extracted internally)
     * @param isError true if status >= 400 or network error
     */
    fun onRequestCaptured(
        isError: Boolean = false,
        method: String = "",
        status: Int? = null,
        url: String = "",
    ) {
        requestCount.incrementAndGet()
        if (isError) errorCount.incrementAndGet()

        val line = buildInboxLine(method, status, url)
        inboxLock.write {
            inboxLines.addLast(line)
            if (inboxLines.size > INBOX_SIZE) inboxLines.removeFirst()
        }

        scheduleUpdate()
    }

    /** Clear the notification and reset counters and inbox. */
    fun clearNotification() {
        notificationManager?.cancel(NOTIFICATION_ID)
        requestCount.set(0)
        errorCount.set(0)
        inboxLock.write { inboxLines.clear() }
    }

    private fun scheduleUpdate() {
        if (pendingUpdate.compareAndSet(false, true)) {
            handler.postDelayed({
                pendingUpdate.set(false)
                postNotification()
            }, 300)
        }
    }

    private fun postNotification() {
        if (!hasNotificationPermission()) return
        val notification = buildNotification() ?: return
        try {
            notificationManager?.notify(NOTIFICATION_ID, notification)
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    private fun buildNotification(): android.app.Notification? {
        // Notification.Builder(context, channelId) requires API 26+.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null

        val openIntent = Intent(context, HakkaActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("action", ACTION_OPEN)
        }
        val openPendingIntent = PendingIntent.getActivity(
            context, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val clearIntent = Intent(context, HakkaNotificationReceiver::class.java).apply {
            action = ACTION_CLEAR
        }
        val clearPendingIntent = PendingIntent.getBroadcast(
            context, 1, clearIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val reqs = requestCount.get()
        val errs = errorCount.get()
        val summaryText = if (errs > 0) "$reqs requests · $errs errors" else "$reqs requests"

        val lines = inboxLock.read { inboxLines.toList() }

        val style = android.app.Notification.InboxStyle()
            .setBigContentTitle("Hakka — $summaryText")
        // Inbox shows newest last; reverse to show newest at top
        lines.asReversed().forEach { style.addLine(it) }
        if (reqs > lines.size) {
            style.setSummaryText("+ ${reqs - lines.size} more")
        }

        return android.app.Notification.Builder(context, CHANNEL_ID)
            // Alpha-only Wok Hei mark (see hakka_ic_notification.xml) — a legacy
            // android.R.drawable.* bitmap renders as a solid gray blob in the status
            // bar since API 21+ treats smallIcon as a silhouette, not a full-color image.
            .setSmallIcon(R.drawable.hakka_ic_notification)
            .setContentTitle("Hakka")
            .setContentText(summaryText)
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setCategory(android.app.Notification.CATEGORY_SERVICE)
            .setStyle(style)
            .addAction(
                R.drawable.hakka_ic_close,
                "Clear",
                clearPendingIntent,
            )
            .build()
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun buildInboxLine(method: String, status: Int?, url: String): String {
        val time = TIME_FORMAT.get()!!.format(Date())
        val path = try { URL(url).let { it.path.ifEmpty { "/" } } } catch (_: Exception) { url.take(40) }
        val statusStr = status?.toString() ?: "···"
        val methodStr = method.ifEmpty { "?" }.uppercase(Locale.US).take(6)
        // Compact: "HH:mm:ss  GET  200  /path"
        return "$time  $methodStr  $statusStr  $path"
    }

    fun getRequestCount(): Int = requestCount.get()
    fun getErrorCount(): Int = errorCount.get()
}
