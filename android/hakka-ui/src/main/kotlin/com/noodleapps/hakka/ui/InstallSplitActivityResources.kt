package com.noodleapps.hakka.ui

import android.content.Context

/** Makes on-demand inspector resources available without requiring Play in bundled hosts. */
internal fun installSplitActivityResources(context: Context) {
    try {
        val splitCompat = Class.forName("com.google.android.play.core.splitcompat.SplitCompat")
        splitCompat.getMethod("installActivity", Context::class.java).invoke(null, context)
    } catch (_: ReflectiveOperationException) {
        // The bundled inspector does not need or ship Play Feature Delivery.
    } catch (_: LinkageError) {
        // Play is optional for the Android UI artifact.
    }
}
