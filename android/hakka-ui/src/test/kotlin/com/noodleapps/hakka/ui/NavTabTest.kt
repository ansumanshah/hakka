package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Pure data checks for the bottom-nav model — no Android View/Context construction
 * involved, so this runs as a plain JUnit test like the rest of hakka-ui's suite
 * (no Robolectric).
 */
class NavTabTest {

    @Test
    fun `exactly five tabs in spec order Network, Stats, Logs, Rules, Storage`() {
        assertEquals(
            listOf("Network", "Stats", "Logs", "Rules", "Storage"),
            NavTab.entries.map { it.label },
        )
    }

    @Test
    fun `every tab has a distinct icon`() {
        val icons = NavTab.entries.map { it.iconRes }
        assertEquals(icons.size, icons.distinct().size)
    }

    @Test
    fun `settings is not one of the five tabs`() {
        // Settings is a persistent header gear, not a sixth bottom-nav slot — asserting
        // its absence here catches a future regression that re-adds it as a tab.
        assertTrue(NavTab.entries.none { it.label.equals("Settings", ignoreCase = true) })
    }

    @Test
    fun `every tab label is non-blank and distinct`() {
        val labels = NavTab.entries.map { it.label }
        assertTrue(labels.all { it.isNotBlank() })
        assertEquals(labels.size, labels.distinct().size)
    }
}
