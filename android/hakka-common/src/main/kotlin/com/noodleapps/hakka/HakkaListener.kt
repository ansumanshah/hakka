package com.noodleapps.hakka

/**
 * Callback interface for receiving captured network requests.
 * No-op implementation: callbacks are never invoked.
 */
fun interface HakkaListener {
    /** Called when a network request completes (success or failure). */
    fun onRequest(request: NetworkRequest)
}