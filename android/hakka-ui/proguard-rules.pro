# Hakka UI ProGuard Consumer Rules
# Android components and React Native reflection entry points must survive R8.

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

# Public API entry points
-keep,allowoptimization class com.noodleapps.hakka.ui.HakkaUI {
    public static com.noodleapps.hakka.ui.HakkaUI getInstance(android.content.Context);
    public void hide();
    public java.util.List captureStorageSnapshots(java.util.Set);
    public kotlin.jvm.functions.Function0 subscribeStructuredLogs(kotlin.jvm.functions.Function1);
}

-keep,allowoptimization,includedescriptorclasses class com.noodleapps.hakka.ui.HakkaBottomSheet {
    public <init>(android.app.Activity, com.noodleapps.hakka.LogStore);
    public void show();
}

-keep,allowoptimization class com.noodleapps.hakka.ui.HakkaBubble {
    public static com.noodleapps.hakka.ui.HakkaBubble getInstance();
    public void show(android.app.Activity, com.noodleapps.hakka.LogStore);
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
