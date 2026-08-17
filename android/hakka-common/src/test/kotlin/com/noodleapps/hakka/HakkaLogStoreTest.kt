package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

class HakkaLogStoreTest {
    private fun entry(id: String, level: LogLevel = LogLevel.INFO) = LogEntry(
        id = id, timestamp = 1000L, level = level, message = "msg-$id",
    )

    @Test
    fun `add then getEntries`() {
        val store = HakkaLogStore(4)
        store.add(entry("a"))
        assertEquals(listOf("a"), store.getEntries().map { it.id })
        assertEquals(1, store.size())
    }

    @Test
    fun `getEntries returns oldest to newest`() {
        val store = HakkaLogStore(4)
        store.add(entry("a"))
        store.add(entry("b"))
        store.add(entry("c"))
        assertEquals(listOf("a", "b", "c"), store.getEntries().map { it.id })
    }

    @Test
    fun `defaults to 500 max entries`() {
        val store = HakkaLogStore()
        repeat(500) { store.add(entry("e$it")) }
        assertEquals(500, store.size())
        store.add(entry("overflow"))
        assertEquals(500, store.size())
        assertEquals("e1", store.getEntries().first().id)
    }

    @Test
    fun `evicts oldest entry once over capacity`() {
        val store = HakkaLogStore(3)
        for (id in listOf("a", "b", "c", "d")) store.add(entry(id))
        assertEquals(3, store.size())
        assertEquals(listOf("b", "c", "d"), store.getEntries().map { it.id })
    }

    @Test
    fun `keeps evicting correctly across multiple wraps`() {
        val store = HakkaLogStore(2)
        for (id in listOf("a", "b", "c", "d", "e")) store.add(entry(id))
        assertEquals(2, store.size())
        assertEquals(listOf("d", "e"), store.getEntries().map { it.id })
    }

    @Test
    fun `subscribers are notified on add`() {
        val store = HakkaLogStore(4)
        val seen = mutableListOf<String>()
        store.subscribe { seen.add(it.id) }
        store.add(entry("a"))
        store.add(entry("b"))
        assertEquals(listOf("a", "b"), seen)
    }

    @Test
    fun `unsubscribe stops further notifications`() {
        val store = HakkaLogStore(4)
        val seen = mutableListOf<String>()
        val off = store.subscribe { seen.add(it.id) }
        store.add(entry("a"))
        off()
        store.add(entry("b"))
        assertEquals(listOf("a"), seen)
    }

    @Test
    fun `multiple listeners are all notified independently`() {
        val store = HakkaLogStore(4)
        val seenA = mutableListOf<String>()
        val seenB = mutableListOf<String>()
        store.subscribe { seenA.add(it.id) }
        val offB = store.subscribe { seenB.add(it.id) }
        store.add(entry("a"))
        offB()
        store.add(entry("b"))
        assertEquals(listOf("a", "b"), seenA)
        assertEquals(listOf("a"), seenB)
    }

    @Test
    fun `clear empties everything`() {
        val store = HakkaLogStore(4)
        store.add(entry("a"))
        store.add(entry("b"))
        store.clear()
        assertEquals(0, store.size())
        assertTrue(store.getEntries().isEmpty())
    }

    @Test
    fun `store is reusable after clear`() {
        val store = HakkaLogStore(4)
        store.add(entry("a"))
        store.clear()
        store.add(entry("b"))
        assertEquals(listOf("b"), store.getEntries().map { it.id })
        assertEquals(1, store.size())
    }

    @Test
    fun `a misbehaving listener does not break other listeners or add`() {
        val store = HakkaLogStore(4)
        val seen = mutableListOf<String>()
        store.subscribe { throw RuntimeException("boom") }
        store.subscribe { seen.add(it.id) }
        store.add(entry("a"))
        assertEquals(listOf("a"), seen)
        assertEquals(1, store.size())
    }

    @Test
    fun `thread safety under concurrent adds`() {
        val store = HakkaLogStore(1000)
        val pool = Executors.newFixedThreadPool(8)
        val latch = CountDownLatch(100)
        repeat(100) { i ->
            pool.submit {
                store.add(entry("t-$i"))
                latch.countDown()
            }
        }
        latch.await()
        assertEquals(100, store.size())
        pool.shutdown()
    }
}
