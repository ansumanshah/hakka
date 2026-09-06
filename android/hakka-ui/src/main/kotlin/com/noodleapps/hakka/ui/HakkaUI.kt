package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.HakkaLogStore
import com.noodleapps.hakka.HakkaPerformance
import com.noodleapps.hakka.HakkaPlugin
import com.noodleapps.hakka.LogEntry
import com.noodleapps.hakka.LogStore
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.StorageSnapshot
import com.noodleapps.hakka.HakkaListener

/**
 * HakkaUI - Entry point for Hakka's UI features.
 *
 * Combines notification management and shake detection.
 * Must be initialized with a [LogStore] so the activity can display requests.
 */
class HakkaUI(private val context: Context) {

    private val notificationManager = HakkaNotificationManager(context)
    private var shakeDetector: ShakeDetector? = null
    private var bottomSheet: HakkaBottomSheet? = null
    private var inspectorActivity: HakkaActivity? = null
    private val presentationState = InspectorPresentationState()

    /** Shared LogStore reference — set via [attach] so HakkaActivity can read requests. */
    @Volatile
    internal var logStore: LogStore? = null

    /**
     * Live interceptor reference — set via [attachInterceptor] so [SettingsActivity] can read
     * [HakkaInterceptor.config] and call [HakkaInterceptor.updateConfig] / `connectBridge` at
     * runtime. Null when the host wired [attach] manually without going through [Hakka.install]
     * — Settings' controls disable themselves in that case rather than silently no-op-ing.
     */
    @Volatile
    internal var interceptor: HakkaInterceptor? = null

    /**
     * Active desktop-bridge connection opened from Settings' "Connect to desktop" toggle, if
     * any. Held here (not on the Activity) so the stream survives Settings being closed and
     * reopened. Close and null it out before opening a new one.
     */
    internal var bridgeConnection: AutoCloseable? = null

    /**
     * Structured application-log store (distinct from the network-capture [logStore]
     * above). Process-wide singleton per [HakkaUI] instance — backs [Hakka.log] /
     * the Compose Logs page, and is what
     * [HakkaTimberTree] forwards Timber calls into.
     */
    internal val hakkaLogStore: HakkaLogStore = HakkaLogStore()

    /** Field names to redact in structured log metadata — mirrors [com.noodleapps.hakka.HakkaConfig.sensitiveBodyFields]. */
    @Volatile
    internal var logRedactedFields: Set<String> = emptySet()

    /**
     * Shared [HakkaPerformance] instance, set by [com.noodleapps.hakka.ui.Hakka.startPerf].
     * When present, the Compose Stats page reads live frame/memory/CPU metrics from
     * this instance instead of spinning up its own frame-only collector — one call
     * to `Hakka.startPerf(context)` is enough to light up the Stats tab.
     */
    @Volatile
    internal var sharedPerformance: HakkaPerformance? = null

    /** Stops and clears the shared performance instance started via `Hakka.startPerf`. */
    internal fun clearSharedPerformance() {
        sharedPerformance?.close()
        sharedPerformance = null
    }

    /**
     * Optional plugin list provider retained for plugin-host integration.
     * Set via [attachPluginProvider] when an interceptor with plugins is available.
     */
    @Volatile
    private var pluginProvider: (() -> List<HakkaPlugin>)? = null

    /**
     * Attach a LogStore so the inspector activity can display captured requests.
     * Call this once during app startup after creating your interceptor.
     */
    fun attach(logStore: LogStore): HakkaUI = apply {
        this.logStore = logStore
    }

    /**
     * Attach the live [HakkaInterceptor] so Settings can read/write its runtime config
     * (max records, retention, redacted body fields, desktop bridge). Called automatically
     * by [Hakka.install]; call it yourself if you construct [HakkaInterceptor] manually.
     */
    fun attachInterceptor(interceptor: HakkaInterceptor): HakkaUI = apply {
        this.interceptor = interceptor
    }

    /**
     * Attach a provider that returns the list of registered plugins.
     *
     * Usage with the real interceptor:
     * ```kotlin
     * HakkaUI.getInstance(context).attachPluginProvider { interceptor.plugins.registeredPlugins() }
     * ```
     */
    fun attachPluginProvider(provider: () -> List<HakkaPlugin>): HakkaUI = apply {
        pluginProvider = provider
    }

    /**
     * Returns the list of registered plugins supplied by the attached plugin provider.
     * Returns an empty list when no provider was attached or on any error.
     */
    internal fun interceptorPlugins(): List<HakkaPlugin> =
        try { pluginProvider?.invoke() ?: emptyList() } catch (_: Exception) { emptyList() }

    /** Initialize with a callback for shake detection. */
    fun init(onShake: () -> Unit) {
        shakeDetector = ShakeDetector(context) { onShake() }
    }

    /** Start listening for shake gestures. */
    fun start() {
        shakeDetector?.start()
    }

    /** Stop listening and clear notification. */
    fun stop() {
        shakeDetector?.stop()
        notificationManager.clearNotification()
    }

    /** Clear notification and reset counters without stopping the shake detector. */
    fun clearNotification() {
        notificationManager.clearNotification()
    }

    /**
     * Notify of a new request (updates notification count and inbox).
     * Thread-safe — called from OkHttp dispatcher threads via [HakkaUILogListener].
     */
    fun onRequest(request: NetworkRequest) {
        try {
            val isError = (request.status ?: 0) >= 400 || request.error != null
            notificationManager.onRequestCaptured(
                isError = isError,
                method = request.method.name,
                status = request.status,
                url = request.url,
            )
            logStore?.let { HakkaBubble.getInstance().updateCount(it.size()) }
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    fun getRequestCount(): Int = notificationManager.getRequestCount()
    fun getErrorCount(): Int = notificationManager.getErrorCount()

    /**
     * Subscribes to newly recorded structured log entries — the same stream [Hakka.log] /
     * [HakkaTimberTree] feed into [hakkaLogStore]. Used by hakka-react-native's
     * `NativeCoreDelegate` (via reflection — hakka-ui is an optional dependency, not on that
     * module's compile classpath) to relay native console entries to the JS bridge as
     * `onHakkaConsole` events. Deliberately independent of [interceptor]/[attachInterceptor]:
     * unlike [Hakka.log]'s own `sendConsoleFrame` call (a no-op until [attachInterceptor] has
     * been called, which RN's native-render mode never does — attaching would also flip on
     * Settings' "connect to desktop bridge" toggle, opening a second socket), this subscribes
     * directly to the entry stream so the relay works whether or not a bridge interceptor is
     * attached. Returns an unsubscribe function.
     */
    fun subscribeStructuredLogs(listener: (LogEntry) -> Unit): () -> Unit =
        hakkaLogStore.subscribe(listener)

    /**
     * Captures one [StorageSnapshot] per SharedPreferences file readable from [context],
     * redacted using [sensitiveFields] (case-insensitive field-name match — same semantics as
     * [com.noodleapps.hakka.HakkaConfig.sensitiveBodyFields]). Independent of [interceptor]:
     * callers supply their own redaction fields, so this works even when no bridge interceptor
     * is attached — e.g. hakka-react-native's on-demand `publishStorageSnapshots()` native
     * module method, which passes its own interceptor's `sensitiveBodyFields`.
     */
    fun captureStorageSnapshots(sensitiveFields: Set<String>): List<StorageSnapshot> =
        SharedPreferencesSnapshotter.capture(context, sensitiveFields)

    /**
     * Show the Hakka floating bubble on the given Activity.
     * Tap the bubble to open the bottom sheet inspector.
     */
    fun show(activity: Activity) {
        try {
            HakkaBubble.getInstance().show(activity, logStore)
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    /** Hide the floating bubble. */
    fun hide() {
        try {
            dismissCurrentPresentation()
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    /**
     * Show the Hakka inspector directly as a bottom sheet overlay.
     * Called by the bubble on tap, or use this for direct sheet access.
     */
    fun showSheet(activity: Activity) {
        try {
            bottomSheet?.hide()
            bottomSheet = HakkaBottomSheet(activity, logStore).also { it.show() }
        } catch (_: Exception) {
            // SDK must never crash the host app
        }
    }

    /**
     * Presents the inspector using the shared gateway used by optional runtime integrations.
     * The attached store and interceptor remain the sole data/control source for every mode.
     */
    fun present(activity: Activity, mode: String, onResult: (Boolean) -> Unit) {
        if (activity.isFinishing || activity.isDestroyed) {
            onResult(false)
            return
        }
        try {
            dismissCurrentPresentation()
            when (mode) {
                "fullscreen" -> {
                    val token = presentationState.beginFullscreen(onResult)
                    activity.startActivity(Intent(activity, HakkaActivity::class.java)
                        .putExtra(FULLSCREEN_REQUEST_TOKEN, token))
                }
                "sheet" -> {
                    showSheet(activity)
                    onResult(bottomSheet?.isShowing() == true)
                }
                else -> {
                    show(activity)
                    onResult(HakkaBubble.getInstance().isShowing())
                }
            }
        } catch (_: Exception) {
            if (!presentationState.cancelPendingFullscreen()) onResult(false)
        }
    }

    internal fun registerInspector(activity: HakkaActivity, requestToken: Long?): Boolean {
        if (requestToken != null && !presentationState.confirmFullscreen(requestToken)) return false
        inspectorActivity = activity
        return true
    }

    internal fun rejectInspector(requestToken: Long?) {
        if (requestToken != null) presentationState.rejectFullscreen(requestToken)
    }

    internal fun unregisterInspector(activity: HakkaActivity) {
        if (inspectorActivity === activity) inspectorActivity = null
    }

    private fun dismissCurrentPresentation() {
        presentationState.cancelPendingFullscreen()
        // A canceled request remains stale because its token is no longer pending.
        HakkaBubble.getInstance().hide()
        bottomSheet?.hide()
        bottomSheet = null
        inspectorActivity?.finish()
        inspectorActivity = null
    }

    companion object {
        internal const val FULLSCREEN_REQUEST_TOKEN = "com.noodleapps.hakka.ui.FULLSCREEN_REQUEST_TOKEN"
        @Volatile
        private var instance: HakkaUI? = null

        @JvmStatic
        fun getInstance(context: Context): HakkaUI {
            return instance ?: synchronized(this) {
                instance ?: HakkaUI(context.applicationContext).also { instance = it }
            }
        }
    }
}

/** [HakkaListener] that forwards captured requests to [HakkaUI] for notification updates. */
class HakkaUILogListener(private val ui: HakkaUI) : HakkaListener {
    override fun onRequest(request: NetworkRequest) {
        ui.onRequest(request)
    }
}
