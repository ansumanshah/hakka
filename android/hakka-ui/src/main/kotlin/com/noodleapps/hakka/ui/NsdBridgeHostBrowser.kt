package com.noodleapps.hakka.ui

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.noodleapps.hakka.BridgeHostBrowser
import com.noodleapps.hakka.DiscoveredBridgeHost
import java.util.concurrent.ConcurrentHashMap

/**
 * [NsdManager]-backed [BridgeHostBrowser] for the Hakka bridge hub's `_hakka._tcp`
 * mDNS/NSD advertisement — Android's equivalent of iOS's `NWBridgeHostBrowser`.
 *
 * Discover-then-resolve NSD flow (`onServiceFound` -> `resolveService` ->
 * `onServiceResolved`), adapted to emit the full known-host list on every change
 * rather than a single host/port callback.
 *
 * Lives in `hakka-ui` (not `hakka-network`, which is plain-JVM with no Android SDK
 * dependency) since [NsdManager] requires a [Context]. Not unit-tested directly — real
 * NSD requires a live Android device/emulator and a real service on the LAN, which is
 * unreliable in CI. [HakkaBridgeDiscovery]'s 0/1/many/retry semantics are covered in
 * `hakka-network`'s `BridgeDiscoveryTest` against a faked [BridgeHostBrowser].
 */
class NsdBridgeHostBrowser(context: Context) : BridgeHostBrowser {

    companion object {
        /** Must match the hub's advertised type in `packages/hakka-bridge/src/discovery.ts`. */
        const val SERVICE_TYPE = "_hakka._tcp."
    }

    private val nsdManager = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifiManager =
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val hosts = ConcurrentHashMap<String, DiscoveredBridgeHost>()

    /**
     * mDNS runs over multicast, and on many OEM builds `NsdManager` silently drops
     * incoming multicast packets unless the app holds a [WifiManager.MulticastLock] —
     * `CHANGE_WIFI_MULTICAST_STATE` in the manifest grants the *permission*, but without
     * actually acquiring the lock it's inert and discovery is unreliable. Reference-count
     * it ourselves (`setReferenceCounted(false)`) rather than relying on the framework's
     * own counting, since [start]/[stop] here are the only acquire/release pair.
     */
    private val multicastLock: WifiManager.MulticastLock? by lazy {
        wifiManager?.createMulticastLock("hakka-bridge-discovery")?.apply { setReferenceCounted(false) }
    }

    @Volatile private var discoveryListener: NsdManager.DiscoveryListener? = null
    @Volatile private var onHostsChanged: ((List<DiscoveredBridgeHost>) -> Unit)? = null
    @Volatile private var multicastLockHeld = false

    override fun start(onHostsChanged: (List<DiscoveredBridgeHost>) -> Unit) {
        this.onHostsChanged = onHostsChanged
        hosts.clear()

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                resolve(serviceInfo)
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                hosts.remove(serviceInfo.serviceName)
                emit()
            }

            override fun onDiscoveryStopped(serviceType: String) = Unit

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                // Surfacing this as an error would change discovery's fallback behavior —
                // HakkaBridgeDiscovery's timeout simply sees zero hosts and (per its
                // retry-once policy) tries again, then settles to `.None`.
                stop()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
        }
        discoveryListener = listener

        runCatching { multicastLock?.acquire() }.onSuccess { multicastLockHeld = true }

        runCatching {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        }.onFailure {
            discoveryListener = null
            releaseMulticastLockIfHeld()
        }
    }

    override fun stop() {
        discoveryListener?.let { listener ->
            runCatching { nsdManager.stopServiceDiscovery(listener) }
        }
        discoveryListener = null
        releaseMulticastLockIfHeld()
    }

    private fun releaseMulticastLockIfHeld() {
        if (multicastLockHeld) {
            multicastLockHeld = false
            runCatching { multicastLock?.release() }
        }
    }

    // `resolveService(NsdServiceInfo, ResolveListener)` and `NsdServiceInfo.host` were
    // deprecated in API 34 in favor of `registerServiceInfoCallback`/`hostAddresses`. Kept
    // deliberately — this module's minSdk is 24, and the newer callback API would need an
    // API-34 branch for little practical benefit on a one-shot LAN lookup.
    private fun resolve(serviceInfo: NsdServiceInfo) {
        val resolveListener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit

            @Suppress("DEPRECATION")
            override fun onServiceResolved(resolvedInfo: NsdServiceInfo) {
                val host = resolvedInfo.host?.hostAddress ?: return
                hosts[resolvedInfo.serviceName] = DiscoveredBridgeHost(host = host, port = resolvedInfo.port)
                emit()
            }
        }
        @Suppress("DEPRECATION")
        runCatching { nsdManager.resolveService(serviceInfo, resolveListener) }
    }

    private fun emit() {
        onHostsChanged?.invoke(hosts.values.toList())
    }
}
