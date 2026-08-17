package com.noodleapps.hakka

import java.util.concurrent.CopyOnWriteArrayList

/**
 * Live [HakkaPluginContext] backed by the real [LogStore], [RecordSinkHub], and a
 * request-listener list shared with [HakkaInterceptor].
 *
 * This is internal to hakka-network; plugins only depend on the [HakkaPluginContext] interface
 * defined in hakka-common.
 */
internal class HakkaPluginContextImpl(
    private val logStore: LogStore,
    private val sinkHub: RecordSinkHub,
    private val onIngest: (NetworkRequest) -> Unit,
    private val requestListeners: CopyOnWriteArrayList<(NetworkRequest) -> Unit>,
) : HakkaPluginContext {

    override fun ingest(request: NetworkRequest) {
        onIngest(request)
    }

    override fun update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean {
        return logStore.update(id, transform)
    }

    override fun onRequest(listener: (NetworkRequest) -> Unit): () -> Unit {
        requestListeners.add(listener)
        return { requestListeners.remove(listener) }
    }

    override fun getLogs(): List<NetworkRequest> = logStore.all().reversed()

    override fun registerSink(sink: RecordSink): () -> Unit {
        val subscription = sinkHub.add(sink)
        return { subscription.close() }
    }
}
