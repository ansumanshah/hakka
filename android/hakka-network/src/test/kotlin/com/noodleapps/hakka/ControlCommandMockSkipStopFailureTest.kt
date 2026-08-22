package com.noodleapps.hakka

import org.json.JSONObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * Unit tests for `mock.add`'s `failure`/`skipCount`/`stopAfter` wire fields —
 * split out of [ControlCommandTest] to keep files small. Mirrors the
 * equivalent cases in
 * `packages/hakka-core/src/engine/__tests__/control.test.ts` and
 * `ios/Tests/HakkaTests/ControlCommandMockSkipStopFailureTests.swift`.
 */
class ControlCommandMockSkipStopFailureTest {

    @AfterEach
    fun tearDown() {
        MockEngine.shared.clearRules()
    }

    private fun json(text: String): JSONObject = JSONObject(text)

    // ── parse: pinned fixtures (shared with TS/Swift — see fixtures/control/README.md) ──

    @Test
    fun `mock-add parses the pinned failure fixture`() {
        val cmd = parseControlCommand(ControlFixtures.readJSON("mock-add-failure.json")) as ControlCommand.MockAdd
        assertEquals("mck-flaky", cmd.rule.id)
        assertEquals("/api/checkout", cmd.rule.pattern)
        assertEquals(MockFailureCode.CANNOT_CONNECT_TO_HOST, cmd.rule.failure?.code)
        assertEquals(0, cmd.rule.skipCount)
        assertNull(cmd.rule.stopAfter)
    }

    @Test
    fun `mock-add parses the pinned skip-stop fixture`() {
        val cmd = parseControlCommand(ControlFixtures.readJSON("mock-add-skip-stop.json")) as ControlCommand.MockAdd
        assertEquals("mck-retry", cmd.rule.id)
        assertEquals("/api/retry", cmd.rule.pattern)
        assertEquals(2, cmd.rule.skipCount)
        assertEquals(3, cmd.rule.stopAfter)
        assertNull(cmd.rule.failure)
    }

    @Test
    fun `mock-add parses the pinned header-values fixture`() {
        val cmd = parseControlCommand(ControlFixtures.readJSON("mock-add-header-values.json")) as ControlCommand.MockAdd
        assertEquals("mck-login", cmd.rule.id)
        assertEquals("/api/login", cmd.rule.pattern)
        assertEquals("session=abc; Path=/", cmd.rule.headers["Set-Cookie"])
        assertEquals(listOf("session=abc; Path=/", "consent=yes; Path=/"), cmd.rule.headerValues["Set-Cookie"])
    }

    // ── parse: valid shapes ─────────────────────────────────────────────────

    @Test
    fun `mock-add parses a failure block`() {
        val cmd = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"fail-1","pattern":"/api/flaky","enabled":true,
                    "failure":{"code":"timeout"},"response":{"status":200,"body":"{}"}}}"""
            )
        ) as ControlCommand.MockAdd
        assertEquals(MockFailureCode.TIMEOUT, cmd.rule.failure?.code)
    }

    @Test
    fun `mock-add parses every failure code`() {
        for (code in MockFailureCode.entries) {
            val cmd = parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"fail-${code.wireValue}","pattern":"/x","enabled":true,
                        "failure":{"code":"${code.wireValue}"},"response":{"status":200,"body":"{}"}}}"""
                )
            ) as? ControlCommand.MockAdd
            assertNotNull(cmd, "expected .MockAdd for code ${code.wireValue}")
            assertEquals(code, cmd?.rule?.failure?.code)
        }
    }

    @Test
    fun `mock-add parses skipCount and stopAfter`() {
        val cmd = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"skip-stop-1","pattern":"/api/retry","enabled":true,
                    "skipCount":2,"stopAfter":3,"response":{"status":200,"body":"{}"}}}"""
            )
        ) as ControlCommand.MockAdd
        assertEquals(2, cmd.rule.skipCount)
        assertEquals(3, cmd.rule.stopAfter)
    }

    @Test
    fun `mock-add without skipCount, stopAfter, or failure defaults to zero, null, null`() {
        val cmd = parseControlCommand(
            json("""{"kind":"mock.add","rule":{"id":"bare","pattern":"/x","enabled":true,"response":{"status":200,"body":"{}"}}}""")
        ) as ControlCommand.MockAdd
        assertEquals(0, cmd.rule.skipCount)
        assertNull(cmd.rule.stopAfter)
        assertNull(cmd.rule.failure)
    }

    @Test
    fun `mock-add skipCount zero and stopAfter zero are explicitly valid`() {
        val cmd = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"zero","pattern":"/x","enabled":true,
                    "skipCount":0,"stopAfter":0,"response":{"status":200,"body":"{}"}}}"""
            )
        ) as ControlCommand.MockAdd
        assertEquals(0, cmd.rule.skipCount)
        assertEquals(0, cmd.rule.stopAfter)
    }

    // ── parse: hostile / malformed ──────────────────────────────────────────

    @Test
    fun `mock-add rejects non-object failure`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,"failure":"nope","response":{"status":200,"body":""}}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects failure missing code`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,"failure":{},"response":{"status":200,"body":""}}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects failure with unknown code`() {
        assertNull(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,
                        "failure":{"code":"meteorStrike"},"response":{"status":200,"body":""}}}"""
                )
            )
        )
    }

    @Test
    fun `mock-add rejects negative skipCount`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,"skipCount":-1,"response":{"status":200,"body":""}}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects non-integer skipCount`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,"skipCount":1.5,"response":{"status":200,"body":""}}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects wrong-type skipCount`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,"skipCount":"3","response":{"status":200,"body":""}}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects negative stopAfter`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,"stopAfter":-1,"response":{"status":200,"body":""}}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects boolean masquerading as skipCount`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"x","enabled":true,"skipCount":true,"response":{"status":200,"body":""}}}""")
            )
        )
    }

    // ── apply: reaches the engine with the exact fields set ─────────────────

    @Test
    fun `applying mock-add with failure and skip-stop reaches the engine`() {
        val cmd = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"r1","pattern":"/api","enabled":true,
                    "failure":{"code":"cannotConnectToHost"},"skipCount":1,"stopAfter":2,
                    "response":{"status":200,"body":"{}"}}}"""
            )
        )!!
        applyControlCommand(cmd)

        val rule = MockEngine.shared.getRules().first()
        assertEquals(MockFailureCode.CANNOT_CONNECT_TO_HOST, rule.failure?.code)
        assertEquals(1, rule.skipCount)
        assertEquals(2, rule.stopAfter)

        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // skipped
        assertEquals(
            MockFailureCode.CANNOT_CONNECT_TO_HOST,
            MockEngine.shared.match("https://example.com/api", "GET")?.failure?.code,
        )
        assertEquals(
            MockFailureCode.CANNOT_CONNECT_TO_HOST,
            MockEngine.shared.match("https://example.com/api", "GET")?.failure?.code,
        )
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // exhausted
    }
}
