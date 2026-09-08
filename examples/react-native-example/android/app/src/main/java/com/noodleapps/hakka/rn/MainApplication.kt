package com.noodleapps.hakka.rn

import android.app.Application
import android.content.Context
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.google.android.play.core.splitcompat.SplitCompat

class MainApplication : Application(), ReactApplication {

  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(base)
    try {
      SplitCompat.install(this)
    } catch (_: LinkageError) {
      // Bundled and capture-only builds do not package Play Feature Delivery.
    }
  }

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
    loadReactNative(this)
  }
}
