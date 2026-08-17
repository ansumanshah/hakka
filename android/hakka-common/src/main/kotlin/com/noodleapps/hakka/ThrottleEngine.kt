package com.noodleapps.hakka

/**
 * ThrottleEngine — simulate network conditions on Android.
 *
 * Mirrors the TypeScript [ThrottleEngine] in packages/hakka-core/src/engine/ThrottleEngine.ts.
 *
 * - Profile selection with the same presets (none, fast-3g, slow-3g, edge, offline).
 * - [delayForBytes] helper used by the OkHttp throttled source to drip response bytes.
 * - Off by default — [isActive] is false until [setProfile] is called with a non-none profile.
 * - Thread-safe via @Volatile config field (reads are always consistent; writes are atomic
 *   reference replacement via the lock).
 *
 * Preset values match the TS engine exactly:
 *   offline  → latencyMs=0,   downloadKbps=0    (connection dropped)
 *   slow-3g  → latencyMs=400, downloadKbps=400
 *   fast-3g  → latencyMs=150, downloadKbps=1500
 *   edge     → latencyMs=250, downloadKbps=240
 */
class ThrottleEngine {

    companion object {
        /** Singleton shared by the interceptor and the UI. */
        val shared = ThrottleEngine()

        /** Preset table — mirrors PRESETS in the TypeScript engine. */
        internal val PRESETS: Map<ThrottleProfile, ThrottleConfig> = mapOf(
            ThrottleProfile.OFFLINE  to ThrottleConfig(ThrottleProfile.OFFLINE,  latencyMs = 0,   downloadKbps = 0),
            ThrottleProfile.SLOW_3G  to ThrottleConfig(ThrottleProfile.SLOW_3G,  latencyMs = 400, downloadKbps = 400),
            ThrottleProfile.FAST_3G  to ThrottleConfig(ThrottleProfile.FAST_3G,  latencyMs = 150, downloadKbps = 1500),
            ThrottleProfile.EDGE     to ThrottleConfig(ThrottleProfile.EDGE,     latencyMs = 250, downloadKbps = 240),
        )
    }

    @Volatile
    private var _config: ThrottleConfig = ThrottleConfig(ThrottleProfile.NONE)

    private val lock = Any()

    /** The active configuration (snapshot; safe to read without a lock). */
    val config: ThrottleConfig get() = _config

    /** True when a non-none profile is active. */
    val isActive: Boolean get() = _config.profile != ThrottleProfile.NONE

    /** True when the offline profile is active (all requests fail). */
    val isOffline: Boolean get() = _config.profile == ThrottleProfile.OFFLINE

    // ── Profile selection ─────────────────────────────────────────────────────

    /**
     * Select a named profile.  Choosing [ThrottleProfile.NONE] resets to pass-through.
     * Choosing [ThrottleProfile.OFFLINE] enables connection-fail mode.
     */
    fun setProfile(profile: ThrottleProfile) {
        synchronized(lock) {
            _config = PRESETS[profile] ?: ThrottleConfig(ThrottleProfile.NONE)
        }
    }

    /**
     * Set a fully custom latency + bandwidth.
     * [downloadKbps] = 0 means no bandwidth throttle (only latency is applied).
     */
    fun setCustom(latencyMs: Long, downloadKbps: Long = 0L) {
        synchronized(lock) {
            _config = ThrottleConfig(
                profile = ThrottleProfile.CUSTOM,
                latencyMs = latencyMs,
                downloadKbps = downloadKbps,
            )
        }
    }

    // ── Interceptor helpers ───────────────────────────────────────────────────

    /**
     * Compute the delay in milliseconds to insert before [byteCount] bytes are delivered
     * at the current [ThrottleConfig.downloadKbps] rate.
     *
     * Formula: (byteCount / bytesPerMs)
     *   where bytesPerMs = (downloadKbps * 1024) / 8 / 1000
     *
     * Returns 0 when [downloadKbps] is 0 (unlimited) or the profile is none.
     * Always returns a non-negative value.
     */
    fun delayForBytes(byteCount: Long): Long {
        val kbps = _config.downloadKbps
        if (kbps <= 0L) return 0L
        val bytesPerMs: Double = kbps.toDouble() * 1024.0 / 8.0 / 1000.0
        return (byteCount.toDouble() / bytesPerMs).toLong().coerceAtLeast(0L)
    }
}

// ── Data model ────────────────────────────────────────────────────────────────

/**
 * Named throttle profiles.  Mirrors `ThrottleProfile` in the TypeScript engine.
 */
enum class ThrottleProfile {
    NONE, FAST_3G, SLOW_3G, EDGE, OFFLINE, CUSTOM
}

/**
 * Active throttle settings.
 *
 * @property profile     The active profile (or [ThrottleProfile.NONE] for pass-through).
 * @property latencyMs   Additional latency to sleep before the request is sent (ms).
 * @property downloadKbps Simulated downstream bandwidth (kbps). 0 = unlimited.
 */
data class ThrottleConfig(
    val profile: ThrottleProfile = ThrottleProfile.NONE,
    val latencyMs: Long = 0L,
    val downloadKbps: Long = 0L,
)
