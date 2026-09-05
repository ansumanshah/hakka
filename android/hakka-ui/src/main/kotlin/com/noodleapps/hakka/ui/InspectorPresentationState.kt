package com.noodleapps.hakka.ui

/** Coordinates asynchronous fullscreen presentation completion without retaining an Activity. */
internal class InspectorPresentationState {
    private var nextToken = 0L
    private var pendingFullscreen: Pair<Long, (Boolean) -> Unit>? = null
    private var acceptedFullscreenToken: Long? = null

    fun beginFullscreen(onResult: (Boolean) -> Unit): Long {
        cancelPendingFullscreen()
        val token = ++nextToken
        pendingFullscreen = token to onResult
        return token
    }

    fun confirmFullscreen(token: Long): Boolean {
        if (acceptedFullscreenToken == token) return true
        val pending = pendingFullscreen ?: return false
        if (pending.first != token) return false
        pendingFullscreen = null
        acceptedFullscreenToken = token
        pending.second(true)
        return true
    }

    fun cancelPendingFullscreen(): Boolean {
        val pending = pendingFullscreen
        val hadFullscreen = pending != null || acceptedFullscreenToken != null
        pendingFullscreen = null
        acceptedFullscreenToken = null
        pending?.second(false)
        return hadFullscreen
    }

    fun rejectFullscreen(token: Long): Boolean {
        val pending = pendingFullscreen ?: return false
        if (pending.first != token) return false
        pendingFullscreen = null
        pending.second(false)
        return true
    }
}
