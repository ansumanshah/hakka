package com.noodleapps.hakka.rn

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Register Hakka's OkHttp interceptor BEFORE React Native creates (and caches)
    // its NetworkingModule client — otherwise fetch/XHR traffic bypasses capture.
    // This is the required Android RN integration step (iOS captures automatically
    // via URLProtocol; Android's OkHttpClientProvider client is cached for the
    // app lifetime, so the factory must be set at startup).
    HakkaOkHttpClientFactory.initialize()
    loadReactNative(this)
  }
}
