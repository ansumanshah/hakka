package com.noodleapps.hakka

import java.util.concurrent.atomic.AtomicBoolean

/** Receives processed records after redaction, normalization, and store mutation. */
fun interface RecordSink {
    fun onRecord(record: ContractRecord)
}

/** Handle returned when registering a sink. Close it to stop delivery. */
class SinkSubscription(
    private val onClose: () -> Unit,
) : AutoCloseable {
    private val closed = AtomicBoolean(false)

    override fun close() {
        if (closed.compareAndSet(false, true)) onClose()
    }
}
