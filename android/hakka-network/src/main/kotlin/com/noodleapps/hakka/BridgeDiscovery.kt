package com.noodleapps.hakka

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * A Hakka bridge hub discovered on the LAN via `_hakka._tcp` mDNS/NSD.
 *
 * Mirrors `DiscoveredBridgeHost` on iOS (`BridgeDiscovery.swift`).
 */
data class DiscoveredBridgeHost(
    val host: String,
    val port: Int,
) {
    /** `ws://` URL suitable for [HakkaInterceptor.Builder.bridgeUrl] / [connectBridge]. */
    val webSocketUrl: String get() = "ws://$host:$port"
}

/**
 * Outcome of applying the zero-config selection semantics to a discovered-host set.
 * Mirrors `BridgeDiscoverySelection` on iOS.
 */
sealed interface BridgeDiscoverySelection {
    /** No hosts found before the discovery timeout — current (no-bridge) behavior. */
    data object None : BridgeDiscoverySelection

    /** Exactly one host found — safe to connect automatically, no ambiguity. */
    data class AutoConnect(val host: DiscoveredBridgeHost) : BridgeDiscoverySelection

    /** More than one host found — surface the list (e.g. in a settings UI), connect to none. */
    data class Ambiguous(val hosts: List<DiscoveredBridgeHost>) : BridgeDiscoverySelection
}

/**
 * Pure 0/1/many selection logic, independent of the NSD transport so it is trivially
 * unit-testable with a faked [BridgeHostBrowser]. Mirrors `BridgeDiscoverySelector` on iOS.
 */
object BridgeDiscoverySelector {
    fun select(hosts: List<DiscoveredBridgeHost>): BridgeDiscoverySelection = when (hosts.size) {
        0 -> BridgeDiscoverySelection.None
        1 -> BridgeDiscoverySelection.AutoConnect(hosts[0])
        else -> BridgeDiscoverySelection.Ambiguous(hosts.toList())
    }
}

/**
 * Abstraction over the platform browsing mechanism. The real implementation
 * (`NsdBridgeHostBrowser`, backed by [android.net.nsd.NsdManager]) lives in the `hakka-ui`
 * module — this module (`hakka-network`) is plain-JVM with no Android SDK dependency, so it
 * cannot reference `NsdManager`/`Context` directly. Keeping the interface here (rather than
 * in `hakka-ui`) lets [HakkaBridgeDiscovery]'s timeout/retry/selection logic be
 * unit-tested in this module with a faked browser, without touching a real NsdManager or
 * requiring Robolectric/instrumented tests.
 */
interface BridgeHostBrowser {
    /**
     * Begin browsing. [onHostsChanged] may be invoked multiple times as results
     * arrive/expire; each call carries the full current known-host set.
     */
    fun start(onHostsChanged: (List<DiscoveredBridgeHost>) -> Unit)

    /** Stop browsing. Safe to call even if [start] was never called, or more than once. */
    fun stop()
}

/**
 * Orchestrates zero-config bridge discovery: browses for `_hakka._tcp` hosts for
 * [timeoutMs], applies [BridgeDiscoverySelector] to whatever was found, and reports the
 * outcome exactly once via the [start] callback.
 *
 * NSD is flaky on some OEM devices — discovery can silently never start, or
 * [android.net.nsd.NsdManager.discoverServices] can time out with zero results even
 * though a hub is advertising — so a zero-result first attempt is retried once per
 * [retryOnEmptyResult]. If both attempts find nothing, the outcome is
 * [BridgeDiscoverySelection.None], same as when `bridgeUrl` is left unset. Never throws.
 */
class HakkaBridgeDiscovery(
    private val browser: BridgeHostBrowser,
    private val timeoutMs: Long = 5_000L,
    private val retryOnEmptyResult: Boolean = true,
    private val scheduler: ScheduledExecutorService = defaultScheduler(),
) {
    /**
     * Single source of truth for whether this run has settled (fired `onSelection`) or
     * been stopped. Must be a single [AtomicReference] CAS, not a separate `AtomicBoolean`
     * check-then-act: it makes "did `stop()` or the timeout task get there first"
     * unambiguous — whichever side wins the transition out of [DiscoveryState.ACTIVE] is
     * the only one that acts.
     */
    private val state = AtomicReference(DiscoveryState.ACTIVE)

    /** Starts browsing. `onSelection` fires exactly once. */
    fun start(onSelection: (BridgeDiscoverySelection) -> Unit) {
        state.set(DiscoveryState.ACTIVE)
        runAttempt(isRetry = false, onSelection)
    }

    /**
     * Stops browsing without firing `onSelection` — used when the caller shuts down
     * before the discovery timeout elapses. Idempotent.
     */
    fun stop() {
        if (state.compareAndSet(DiscoveryState.ACTIVE, DiscoveryState.STOPPED)) {
            browser.stop()
            scheduler.shutdown()
        }
    }

    private fun runAttempt(isRetry: Boolean, onSelection: (BridgeDiscoverySelection) -> Unit) {
        val latestHosts = CopyOnWriteArrayList<DiscoveredBridgeHost>()
        browser.start { hosts ->
            latestHosts.clear()
            latestHosts.addAll(hosts)
        }
        scheduler.schedule(
            {
                browser.stop()
                if (latestHosts.isEmpty() && retryOnEmptyResult && !isRetry) {
                    if (state.get() == DiscoveryState.ACTIVE) {
                        runAttempt(isRetry = true, onSelection)
                    }
                } else if (state.compareAndSet(DiscoveryState.ACTIVE, DiscoveryState.SETTLED)) {
                    scheduler.shutdown()
                    onSelection(BridgeDiscoverySelector.select(latestHosts.toList()))
                }
            },
            timeoutMs,
            TimeUnit.MILLISECONDS,
        )
    }

    private enum class DiscoveryState { ACTIVE, SETTLED, STOPPED }

    private companion object {
        fun defaultScheduler(): ScheduledExecutorService =
            Executors.newSingleThreadScheduledExecutor { r ->
                Thread(r, "HakkaBridgeDiscovery").apply { isDaemon = true }
            }
    }
}

/**
 * Attaches a [BridgeSink] to [this] interceptor for a bridge hub discovered at runtime
 * (e.g. via [HakkaBridgeDiscovery] + `NsdBridgeHostBrowser`), without exposing the
 * `internal` [BridgeSink] type itself. Equivalent to setting
 * [HakkaInterceptor.Builder.bridgeUrl] at construction time, but usable any time after the
 * interceptor is already built and running — which is exactly when discovery settles.
 *
 * Returns an [AutoCloseable] that both unregisters the sink from the fan-out *and* closes
 * the underlying [BridgeSink] (cancelling its reconnect loop and socket) — closing only the
 * fan-out registration (as a bare [SinkSubscription] would) leaves the WebSocket connection
 * and its reconnect-with-backoff loop running in the background indefinitely.
 */
fun HakkaInterceptor.connectBridge(url: String): AutoCloseable {
    val sink = BridgeSink(url)
    val subscription = addSink(sink)
    return AutoCloseable {
        subscription.close()
        sink.close()
    }
}
