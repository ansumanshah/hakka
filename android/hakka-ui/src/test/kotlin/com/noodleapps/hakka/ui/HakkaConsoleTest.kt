package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class HakkaConsoleTest {

    @BeforeEach
    fun setup() {
        HakkaConsole.clear()
    }

    @Test
    fun `log stores entry and all() returns newest first`() {
        HakkaConsole.i("TagA", "first")
        HakkaConsole.i("TagA", "second")

        val entries = HakkaConsole.all()
        assertEquals(2, entries.size)
        assertEquals("second", entries[0].message)
        assertEquals("first", entries[1].message)
    }

    @Test
    fun `convenience methods set correct levels`() {
        HakkaConsole.v("T", "verbose")
        HakkaConsole.d("T", "debug")
        HakkaConsole.i("T", "info")
        HakkaConsole.w("T", "warn")
        HakkaConsole.e("T", "error")

        val entries = HakkaConsole.all().reversed() // oldest first
        assertEquals(ConsoleLevel.VERBOSE, entries[0].level)
        assertEquals(ConsoleLevel.DEBUG, entries[1].level)
        assertEquals(ConsoleLevel.INFO, entries[2].level)
        assertEquals(ConsoleLevel.WARN, entries[3].level)
        assertEquals(ConsoleLevel.ERROR, entries[4].level)
    }

    @Test
    fun `clear removes all entries`() {
        HakkaConsole.i("T", "msg")
        assertEquals(1, HakkaConsole.size())
        HakkaConsole.clear()
        assertEquals(0, HakkaConsole.size())
        assertTrue(HakkaConsole.all().isEmpty())
    }

    @Test
    fun `buffer is bounded to MAX_ENTRIES`() {
        val max = HakkaConsole.MAX_ENTRIES
        repeat(max + 50) { i -> HakkaConsole.d("T", "msg $i") }

        // Should be capped at MAX_ENTRIES
        assertEquals(max, HakkaConsole.size())
        // Newest entries should be retained
        val all = HakkaConsole.all() // newest first
        assertEquals("msg ${max + 49}", all[0].message)
    }

    @Test
    fun `tag and message are stored correctly`() {
        HakkaConsole.log(ConsoleLevel.WARN, "MyTag", "My message")
        val entry = HakkaConsole.all().first()
        assertEquals("MyTag", entry.tag)
        assertEquals("My message", entry.message)
        assertEquals(ConsoleLevel.WARN, entry.level)
    }

    @Test
    fun `ids are monotonically increasing`() {
        HakkaConsole.i("T", "first")
        HakkaConsole.i("T", "second")
        val entries = HakkaConsole.all().reversed() // oldest first
        assertTrue(entries[0].id < entries[1].id)
    }
}
