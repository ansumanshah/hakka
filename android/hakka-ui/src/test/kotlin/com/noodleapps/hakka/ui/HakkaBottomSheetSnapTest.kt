package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * [snapTarget] is the pure decision half of [HakkaBottomSheet]'s drag-release handling — see
 * its doc comment. Regression coverage for the bug where the caller used to pass cumulative
 * touch displacement (`event.rawY - dragStartY`, unit-mismatched px and time-independent)
 * instead of a real VelocityTracker px/s reading: a slow, deliberate drag past 300px used to
 * dismiss the sheet exactly like a fast fling. Kept pure (no Android view/motion-event types)
 * so it's testable without Robolectric, like [exceedsTouchSlop].
 */
class HakkaBottomSheetSnapTest {

    private val mediumHeight = 600
    private val largeHeight = 920
    private val minFlingVelocityPxPerSec = 1000f

    @Test
    fun `slow deliberate drag past the old 300px displacement threshold does not dismiss`() {
        // Regression for the bug: cumulative displacement alone used to cross 300 and
        // dismiss here regardless of how long the drag took. A real low px-per-second
        // velocity below the fling threshold must not trigger the fling-dismiss branch.
        val target = snapTarget(
            velocityPxPerSec = 50f,
            minFlingVelocityPxPerSec = minFlingVelocityPxPerSec,
            currentHeight = 400, // well above 30% of medium (180) — a mid-drag position
            mediumHeight = mediumHeight,
            largeHeight = largeHeight,
        )
        assertEquals(mediumHeight, target)
    }

    @Test
    fun `fast downward fling below medium still dismisses`() {
        val target = snapTarget(
            velocityPxPerSec = 1500f,
            minFlingVelocityPxPerSec = minFlingVelocityPxPerSec,
            currentHeight = 400,
            mediumHeight = mediumHeight,
            largeHeight = largeHeight,
        )
        assertEquals(0, target)
    }

    @Test
    fun `position below 30 percent of medium dismisses even at zero velocity`() {
        val target = snapTarget(
            velocityPxPerSec = 0f,
            minFlingVelocityPxPerSec = minFlingVelocityPxPerSec,
            currentHeight = 100, // below mediumHeight * 0.3 = 180
            mediumHeight = mediumHeight,
            largeHeight = largeHeight,
        )
        assertEquals(0, target)
    }

    @Test
    fun `position above 75 percent of large snaps to large`() {
        val target = snapTarget(
            velocityPxPerSec = 0f,
            minFlingVelocityPxPerSec = minFlingVelocityPxPerSec,
            currentHeight = 900, // above largeHeight * 0.75 = 690
            mediumHeight = mediumHeight,
            largeHeight = largeHeight,
        )
        assertEquals(largeHeight, target)
    }

    @Test
    fun `fast fling at or above medium height does not force a dismiss`() {
        // The fling-dismiss branch is guarded by currentHeight < mediumHeight — a fast
        // release from a position already at/above medium should not be treated as dismiss.
        val target = snapTarget(
            velocityPxPerSec = 1500f,
            minFlingVelocityPxPerSec = minFlingVelocityPxPerSec,
            currentHeight = 600,
            mediumHeight = mediumHeight,
            largeHeight = largeHeight,
        )
        assertEquals(mediumHeight, target)
    }
}
