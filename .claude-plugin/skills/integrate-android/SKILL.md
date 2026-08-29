# hakka-integrate-android

Add Hakka network and performance monitoring to a native Android project — configures Maven artifacts with a debug/noop release split and attaches the OkHttp interceptor.

## Steps

1. Add the NoodleApps Maven repository to your project's `settings.gradle.kts` (or `build.gradle`):

   ```kotlin
   dependencyResolutionManagement {
     repositories {
       // ... other repos
       maven { url = uri("https://maven.pkg.github.com/ansumanshah/hakka") }
     }
   }
   ```

   If the artifact is hosted elsewhere (JitPack, custom server), replace the URL with the published location. Confirm the current Maven URL in `docs/RELEASE_CHECKLIST.md` once published.

2. Add network artifacts to `app/build.gradle.kts` (debug captures, release is a noop):

   ```kotlin
   dependencies {
     debugImplementation("com.noodleapps.hakka:hakka-network:0.0.1")
     releaseImplementation("com.noodleapps.hakka:hakka-network-noop:0.0.1")
   }
   ```

   Optionally add performance monitoring:

   ```kotlin
   debugImplementation("com.noodleapps.hakka:hakka-performance:0.0.1")
   releaseImplementation("com.noodleapps.hakka:hakka-performance-noop:0.0.1")
   ```

3. Sync Gradle: `./gradlew :app:assembleDebug`

4. Attach the interceptor to your `OkHttpClient`:

   ```kotlin
   import com.noodleapps.hakka.HakkaInterceptor

   val interceptor = HakkaInterceptor {
     maxRequests = 500
     redactHeaders = setOf("authorization", "cookie", "x-api-key")
   }

   val client = OkHttpClient.Builder()
     .addInterceptor(interceptor)
     .eventListenerFactory(interceptor.eventListenerFactory()!!)
     .build()
   ```

   The noop release variant has the same `HakkaInterceptor` API surface but does nothing — no conditional `BuildConfig.DEBUG` guards needed.

5. Run a test request and inspect `interceptor.logStore.recent(10)` to confirm capture is working. The log store contains `NetworkRequest` records with method, URL, status, timing, and headers.

6. Clean up resources when the client is no longer needed (e.g. `Application.onTerminate`):
   ```kotlin
   interceptor.close()
   ```
