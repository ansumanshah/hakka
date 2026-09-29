package com.noodleapps.hakka.rn

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient

/** Adds capture while preserving the host client's networking configuration. */
object HakkaOkHttpClientFactory {
    private var isInitialized = false
    private var automaticInstallation = true

    /** Call before autolinked packages are constructed when the host owns RN networking. */
    @JvmStatic
    @Synchronized
    fun disableAutomaticInstallation() {
        automaticInstallation = false
    }

    /** Install before RN networking modules are created; fresh clients retain the host factory. */
    @JvmStatic
    @Synchronized
    fun configure(factory: OkHttpClientFactory) {
        OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
            override fun createNewNetworkModuleClient(): OkHttpClient =
                withCapture(factory.createNewNetworkModuleClient())
        })
        isInitialized = true
    }

    /** Use in a host-owned factory, including factories installed after package construction. */
    @JvmStatic
    fun withCapture(client: OkHttpClient): OkHttpClient =
        if (client.interceptors.any { it === NativeCoreDelegate.interceptor }) client
        else client.newBuilder().addInterceptor(NativeCoreDelegate.interceptor).build()

    @Synchronized
    fun initialize() {
        if (isInitialized || !automaticInstallation) return
        // RN exposes no factory getter. Snapshot its current factory's client before replacement.
        try {
            val client = OkHttpClientProvider.createClient()
            configure(object : OkHttpClientFactory {
                override fun createNewNetworkModuleClient(): OkHttpClient = client
            })
        } catch (_: Exception) {
            // A failed host snapshot leaves its factory intact and permits a later retry.
        }
    }
}
