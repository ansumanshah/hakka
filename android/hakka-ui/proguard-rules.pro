# Hakka UI ProGuard Consumer Rules
# Activities, BroadcastReceivers, and UI classes must survive R8.

# Activities launched via Intent
-keep class com.noodleapps.hakka.ui.HakkaActivity { *; }
-keep class com.noodleapps.hakka.ui.DetailActivity { *; }
-keep class com.noodleapps.hakka.ui.SettingsActivity { *; }

# BroadcastReceiver registered in manifest
-keep class com.noodleapps.hakka.ui.HakkaNotificationReceiver { *; }

# Public API entry points
-keep class com.noodleapps.hakka.ui.HakkaUI { *; }
-keep class com.noodleapps.hakka.ui.HakkaUILogListener { *; }

# Timber is compileOnly — the host app provides it, and the Timber bridge
# (HakkaTimberTree) is an optional convenience. A consumer that does not use
# Timber has no timber.log.** on its classpath, so R8 sees an unresolved
# supertype it can never call and fails the build with "Missing class
# timber.log.Timber". Suppress it: the reference is unreachable in exactly the
# builds where the class is absent.
-dontwarn timber.log.**

# OkHttp is compileOnly here for the same reason (hakka-network owns the real
# integration). Consumers that pull hakka-ui without OkHttp on the classpath hit
# the identical unresolved-reference failure.
-dontwarn okhttp3.**
-dontwarn okio.**
