package com.noodleapps.hakka.rn

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient

/**
 * Installs the one RN networking client path. The managed interceptor owns capture, mocks,
 * breakpoints, and throttling, so the native inspector and the JS bridge control the same engine.
 */
object HakkaOkHttpClientFactory {
    private var isInitialized = false

    fun initialize() {
        if (isInitialized) return
        try {
            OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
                override fun createNewNetworkModuleClient(): OkHttpClient {
                    val builder = OkHttpClientProvider.createClientBuilder()
                    builder.addInterceptor(NativeCoreDelegate.interceptor)
                    builder.addNetworkInterceptor(HakkaNetworkInterceptor())
                    return builder.build()
                }
            })
            isInitialized = true
        } catch (e: Exception) {
            android.util.Log.e("HakkaOkHttpClientFactory", "Failed to inject interceptor", e)
        }
    }
}
