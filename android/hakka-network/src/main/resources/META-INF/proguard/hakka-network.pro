# Hakka Core ProGuard Consumer Rules
# Bundled in AAR — app developers don't need to add any rules.

-keep class com.noodleapps.hakka.** { *; }

-keepclassmembers class * implements com.noodleapps.hakka.HakkaListener {
    <methods>;
}

-keepclassmembers class * implements com.noodleapps.hakka.StorageAdapter {
    <methods>;
}
