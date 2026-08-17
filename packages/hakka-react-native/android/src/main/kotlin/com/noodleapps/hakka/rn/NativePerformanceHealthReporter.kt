package com.noodleapps.hakka.rn

import com.noodleapps.hakka.HealthReportRecord

interface NativePerformanceHealthReporter : AutoCloseable {
    fun healthReport(): HealthReportRecord?
}

object NativePerformanceLoader {
    fun create(): NativePerformanceHealthReporter? =
        try {
            Class.forName("com.noodleapps.hakka.rn.NativePerformanceDelegate")
                .getDeclaredConstructor()
                .newInstance() as? NativePerformanceHealthReporter
        } catch (_: ClassNotFoundException) {
            null
        } catch (_: NoClassDefFoundError) {
            null
        } catch (_: LinkageError) {
            null
        } catch (_: ReflectiveOperationException) {
            null
        }
}
