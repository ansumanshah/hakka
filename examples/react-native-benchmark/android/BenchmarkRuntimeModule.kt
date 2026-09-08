package com.noodleapps.hakka.rn

import android.os.Debug
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager
import java.io.File

class BenchmarkRuntimeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "RNBenchmarkRuntime"

  override fun getConstants() = mapOf(
    "variant" to BuildConfig.BENCHMARK_VARIANT,
    "serverUrl" to "http://10.0.2.2:4177",
    "autoRun" to true,
    "showUI" to MainActivity.shouldShowHakkaInspector,
  )

  @ReactMethod
  fun getCapturedCount(promise: Promise) {
    if (BuildConfig.BENCHMARK_VARIANT != "chucker") {
      promise.resolve(null)
      return
    }
    try {
      val store = Class.forName("com.noodleapps.hakka.rn.BenchmarkNetworking")
      val method = store.getMethod("getPersistedCaptureCount", android.content.Context::class.java)
      promise.resolve(method.invoke(null, context) as Int)
    } catch (error: Exception) {
      promise.reject("CAPTURE_COUNT", error)
    }
  }

  @ReactMethod
  fun getEnvironment(promise: Promise) {
    val result = Arguments.createMap()
    result.putString("targetKind", "android-emulator-or-device")
    result.putString("model", android.os.Build.MODEL)
    result.putString("sdk", android.os.Build.VERSION.SDK_INT.toString())
    result.putBoolean("debugBuild", BuildConfig.DEBUG)
    result.putDouble("residentPssBytes", Debug.getPss().toDouble() * 1024)
    result.putDouble("deviceUptimeMs", SystemClock.elapsedRealtime().toDouble())
    promise.resolve(result)
  }

  @ReactMethod
  fun writeResult(json: String, promise: Promise) {
    try {
      val destination = File(context.getExternalFilesDir(null), "hakka-rn-benchmark-result.json")
      destination.writeText(json)
      promise.resolve(destination.absolutePath)
    } catch (error: Exception) {
      promise.reject("WRITE_RESULT", error)
    }
  }
}

class BenchmarkRuntimePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BenchmarkRuntimeModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
