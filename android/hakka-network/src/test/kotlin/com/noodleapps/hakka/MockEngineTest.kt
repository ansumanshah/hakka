package com.noodleapps.hakka

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Unit tests for [MockEngine] — specifically the caller-supplied id + replace-by-id
 * semantics required by the control-frame contract (`mock.add` REPLACES an existing rule
 * in place rather than creating a duplicate, mirroring `MockEngine.addRule` in
 * `packages/hakka-core/src/engine/MockEngine.ts`).
 */
class MockEngineTest {

    @AfterEach
    fun tearDown() {
        MockEngine.shared.clearRules()
    }

    @Test
    fun `addRule without an id generates one`() {
        val id = MockEngine.shared.addRule(
            MockRuleInput(pattern = "/x", response = MockResponse(status = 200))
        )
        assertTrue(id.isNotEmpty())
        assertNotNull(MockEngine.shared.getRules().find { it.id == id })
    }

    @Test
    fun `addRule honors a caller-supplied id`() {
        val id = MockEngine.shared.addRule(
            MockRuleInput(pattern = "/x", response = MockResponse(status = 200), id = "caller-id")
        )
        assertEquals("caller-id", id)
        assertNotNull(MockEngine.shared.getRules().find { it.id == "caller-id" })
    }

    @Test
    fun `addRule with duplicate id replaces the rule in place, not a duplicate`() {
        MockEngine.shared.addRule(
            MockRuleInput(pattern = "/first", response = MockResponse(status = 200), id = "dup")
        )
        MockEngine.shared.addRule(
            MockRuleInput(pattern = "/second", response = MockResponse(status = 404), enabled = false, id = "dup")
        )

        val matches = MockEngine.shared.getRules().filter { it.id == "dup" }
        assertEquals(1, matches.size)
        assertEquals("/second", matches.first().pattern)
        assertEquals(404, matches.first().response.status)
        assertFalse(matches.first().enabled)
    }

    @Test
    fun `regex flags preserve Unicode case insensitive matching`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "https://example\\.test/ÄPI",
                isRegex = true,
                regexFlags = "i",
                response = MockResponse(),
            ),
        )

        assertNotNull(MockEngine.shared.match("https://example.test/äpi", "GET"))
    }

    @Test
    fun `regex flags preserve multiline dotall and per-rule cache behavior`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                id = "plain",
                pattern = "^line$",
                isRegex = true,
                response = MockResponse(),
            ),
        )
        MockEngine.shared.addRule(
            MockRuleInput(
                id = "multiline",
                pattern = "^line$",
                isRegex = true,
                regexFlags = "m",
                response = MockResponse(),
            ),
        )
        MockEngine.shared.addRule(
            MockRuleInput(
                id = "dotall",
                pattern = "start.end",
                isRegex = true,
                regexFlags = "s",
                response = MockResponse(),
            ),
        )

        assertEquals("multiline", MockEngine.shared.match("before\nline\nafter", "GET")?.id)
        assertEquals("dotall", MockEngine.shared.match("start\nend", "GET")?.id)
    }

    @Test
    fun `two calls without an id generate distinct ids`() {
        val id1 = MockEngine.shared.addRule(MockRuleInput(pattern = "/a", response = MockResponse()))
        val id2 = MockEngine.shared.addRule(MockRuleInput(pattern = "/b", response = MockResponse()))
        assertNotEquals(id1, id2)
        assertEquals(2, MockEngine.shared.getRules().size)
    }

    @Test
    fun `replace-by-id preserves rule position (does not move it to the end)`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/a", response = MockResponse(), id = "a"))
        MockEngine.shared.addRule(MockRuleInput(pattern = "/b", response = MockResponse(), id = "b"))
        MockEngine.shared.addRule(MockRuleInput(pattern = "/c", response = MockResponse(), id = "c"))

        MockEngine.shared.addRule(MockRuleInput(pattern = "/b-replaced", response = MockResponse(), id = "b"))

        val ids = MockEngine.shared.getRules().map { it.id }
        assertEquals(listOf("a", "b", "c"), ids)
        assertEquals("/b-replaced", MockEngine.shared.getRules()[1].pattern)
    }

    // ── redirectTo / block / modify (parity with MockEngine.ts) ────────────────

    @Test
    fun `defaults have no redirectTo, block false, modify null, and are not rewrite`() {
        val id = MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse()))
        val rule = MockEngine.shared.getRules().find { it.id == id }
        assertNull(rule?.redirectTo)
        assertFalse(rule!!.block)
        assertNull(rule.modify)
        assertFalse(rule.isRewrite)
    }

    @Test
    fun `redirectTo is carried through and marks the rule as rewrite`() {
        val id = MockEngine.shared.addRule(
            MockRuleInput(pattern = "/api", response = MockResponse(), redirectTo = "https://other.example.com/api")
        )
        val rule = MockEngine.shared.getRules().find { it.id == id }
        assertEquals("https://other.example.com/api", rule?.redirectTo)
        assertTrue(rule!!.isRewrite)
    }

    @Test
    fun `block is carried through but does not alone mark the rule as rewrite`() {
        val id = MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), block = true))
        val rule = MockEngine.shared.getRules().find { it.id == id }
        assertTrue(rule!!.block)
        // isRewrite mirrors MockEngine.ts exactly: it only reflects redirectTo/modify.
        // block is checked ahead of isRewrite by the caller (HakkaInterceptor).
        assertFalse(rule.isRewrite)
    }

    @Test
    fun `modify is carried through and marks the rule as rewrite`() {
        val modify = MockRuleModify(
            setRequestHeaders = mapOf("X-A" to "1"),
            removeRequestHeaders = listOf("X-B"),
            setQueryParams = mapOf("q" to "1"),
            removeQueryParams = listOf("r"),
            status = 201,
            setResponseHeaders = mapOf("X-C" to "2"),
            removeResponseHeaders = listOf("X-D"),
            replaceBody = listOf(MockRuleModify.BodyReplacement("a", "b")),
        )
        val id = MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), modify = modify))
        val rule = MockEngine.shared.getRules().find { it.id == id }
        assertEquals(modify, rule?.modify)
        assertTrue(rule!!.isRewrite)
    }

    // ── subscribe (mirrors BreakpointEngine.subscribe, added for MocksPanel) ───────

    @Test
    fun `subscribe is notified on addRule`() {
        var notified = false
        val unsubscribe = MockEngine.shared.subscribe { notified = true }
        try {
            MockEngine.shared.addRule(MockRuleInput(pattern = "/x", response = MockResponse()))
            assertTrue(notified)
        } finally {
            unsubscribe()
        }
    }

    @Test
    fun `subscribe is notified on removeRule, enableRule, disableRule, and clearRules`() {
        val id = MockEngine.shared.addRule(MockRuleInput(pattern = "/x", response = MockResponse()))
        var count = 0
        val unsubscribe = MockEngine.shared.subscribe { count++ }
        try {
            MockEngine.shared.disableRule(id)
            MockEngine.shared.enableRule(id)
            MockEngine.shared.removeRule(id)
            MockEngine.shared.clearRules()
            assertEquals(4, count)
        } finally {
            unsubscribe()
        }
    }

    @Test
    fun `unsubscribe stops further notifications`() {
        var count = 0
        val unsubscribe = MockEngine.shared.subscribe { count++ }
        MockEngine.shared.addRule(MockRuleInput(pattern = "/x", response = MockResponse()))
        unsubscribe()
        MockEngine.shared.addRule(MockRuleInput(pattern = "/y", response = MockResponse()))
        assertEquals(1, count)
    }
}
