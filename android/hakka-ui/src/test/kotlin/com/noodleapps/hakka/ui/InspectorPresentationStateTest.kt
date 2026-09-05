package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class InspectorPresentationStateTest {
    @Test
    fun `fullscreen resolves only after activity registration`() {
        val state = InspectorPresentationState()
        val results = mutableListOf<Boolean>()

        val token = state.beginFullscreen { results += it }

        assertTrue(results.isEmpty())
        assertTrue(state.confirmFullscreen(token))
        assertEquals(listOf(true), results)
        assertTrue(state.confirmFullscreen(token))
        assertEquals(listOf(true), results)
    }

    @Test
    fun `dismiss and mode switch cancel a pending fullscreen exactly once`() {
        val state = InspectorPresentationState()
        val results = mutableListOf<Boolean>()

        state.beginFullscreen { results += it }
        state.cancelPendingFullscreen()
        state.cancelPendingFullscreen()
        val stale = state.beginFullscreen { results += it }
        val current = state.beginFullscreen { results += it }

        assertEquals(listOf(false, false), results)
        assertFalse(state.confirmFullscreen(stale))
        assertTrue(state.confirmFullscreen(current))
        assertEquals(listOf(false, false, true), results)
    }

    @Test
    fun `repeated dismiss keeps a canceled activity token stale`() {
        val state = InspectorPresentationState()
        val results = mutableListOf<Boolean>()
        val token = state.beginFullscreen { results += it }

        state.cancelPendingFullscreen()
        state.cancelPendingFullscreen()

        assertEquals(listOf(false), results)
        assertFalse(state.confirmFullscreen(token))
    }

    @Test
    fun `activity recreation accepts the active token without resolving twice`() {
        val state = InspectorPresentationState()
        val results = mutableListOf<Boolean>()
        val token = state.beginFullscreen { results += it }

        assertTrue(state.confirmFullscreen(token))
        assertTrue(state.confirmFullscreen(token))
        state.cancelPendingFullscreen()

        assertEquals(listOf(true), results)
        assertFalse(state.confirmFullscreen(token))
    }

    @Test
    fun `setup failure rejects only its matching pending token`() {
        val state = InspectorPresentationState()
        val results = mutableListOf<Boolean>()
        val stale = state.beginFullscreen { results += it }
        val current = state.beginFullscreen { results += it }

        assertFalse(state.rejectFullscreen(stale))
        assertTrue(state.rejectFullscreen(current))
        assertEquals(listOf(false, false), results)
    }
}
