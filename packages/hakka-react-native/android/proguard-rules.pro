# Reflection bridge into the optional hakka-ui artifact. These members are kept by
# the React Native package only; ordinary hakka-ui consumers can still shrink APIs
# they do not call.
-keep,allowoptimization class com.noodleapps.hakka.ui.HakkaUI {
    public static com.noodleapps.hakka.ui.HakkaUI getInstance(android.content.Context);
    public com.noodleapps.hakka.ui.HakkaUI attach(com.noodleapps.hakka.LogStore);
    public com.noodleapps.hakka.ui.HakkaUI attachInterceptor(com.noodleapps.hakka.HakkaInterceptor);
    public com.noodleapps.hakka.ui.HakkaUI attachPluginProvider(kotlin.jvm.functions.Function0);
    public void present(android.app.Activity, java.lang.String, kotlin.jvm.functions.Function1);
    public void hide();
    public java.util.List captureStorageSnapshots(java.util.Set);
    public kotlin.jvm.functions.Function0 subscribeStructuredLogs(kotlin.jvm.functions.Function1);
}
