# Hakka UI ProGuard Consumer Rules
# Android components launched outside static call paths must survive R8.

# Activities launched via Intent
-keep,allowoptimization class com.noodleapps.hakka.ui.HakkaActivity {
    public <init>();
}
-keep,allowoptimization class com.noodleapps.hakka.ui.DetailActivity {
    public <init>();
}
-keep,allowoptimization class com.noodleapps.hakka.ui.SettingsActivity {
    public <init>();
}

# BroadcastReceiver registered in manifest
-keep,allowoptimization class com.noodleapps.hakka.ui.HakkaNotificationReceiver {
    public <init>();
    public void onReceive(android.content.Context, android.content.Intent);
}

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
