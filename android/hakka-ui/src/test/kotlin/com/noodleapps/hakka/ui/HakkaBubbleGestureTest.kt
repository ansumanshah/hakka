package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * [exceedsTouchSlop] is the pure-math half of the drag-vs-long-press guarantee: once
 * cumulative movement from ACTION_DOWN exceeds the platform's drag slop, the bubble's
 * touch listener latches into "dragging" and long-press can never fire (see
 * [HakkaBubble]'s touch-handling doc comment). Kept as float math with no
 * MotionEvent/Context so it's testable without Robolectric, like the rest of
 * hakka-ui's suite.
 */
class HakkaBubbleGestureTest {

    @Test
    fun `jitter within slop on both axes is not a drag`() {
        assertFalse(exceedsTouchSlop(dx = 2f, dy = 2f, slopPx = 10))
    }

    @Test
    fun `movement past slop on a single axis is a drag`() {
        assertTrue(exceedsTouchSlop(dx = 15f, dy = 0f, slopPx = 10))
    }

    @Test
    fun `diagonal movement whose components each stay under slop can still exceed it`() {
        // Neither axis alone crosses 10px, but the Euclidean distance (~11.3px) does —
        // a naive per-axis check would wrongly let this through as a tap/long-press.
        assertTrue(exceedsTouchSlop(dx = 8f, dy = 8f, slopPx = 10))
    }

    @Test
    fun `movement exactly at the slop boundary does not count as exceeding it`() {
        assertFalse(exceedsTouchSlop(dx = 10f, dy = 0f, slopPx = 10))
    }
}
