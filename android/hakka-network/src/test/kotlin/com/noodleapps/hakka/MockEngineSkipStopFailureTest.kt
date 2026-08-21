package com.noodleapps.hakka

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * Unit tests for [MockEngine]'s `skipCount`/`stopAfter`/`failure` support — mirrors
 * `packages/hakka-core/src/capture/__tests__/mockSkipStopFailure.test.ts` and
 * `ios/Tests/HakkaTests/MockEngineSkipStopFailureTests.swift`.
 */
class MockEngineSkipStopFailureTest {

    @AfterEach
    fun tearDown() {
        MockEngine.shared.clearRules()
    }

    // MARK: - Defaults

    @Test
    fun `defaults have no failure, zero skipCount, unlimited stopAfter`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse()))
        val rule = MockEngine.shared.match("https://example.com/api", "GET")
        assertNull(rule?.failure)
        assertEquals(0, rule?.skipCount)
        assertNull(rule?.stopAfter)
    }

    // MARK: - skipCount

    @Test
    fun `skipCount zero applies immediately`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(body = "M"), skipCount = 0))
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET"))
    }

    @Test
    fun `skipCount N skips the first N matches then applies`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(body = "M"), skipCount = 2))
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 1: skipped
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 2: skipped
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 3: applies
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 4: still applies
    }

    @Test
    fun `skipped matches do not increment hitCount`() {
        val id = MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = 1))
        MockEngine.shared.match("https://example.com/api", "GET") // skipped
        MockEngine.shared.match("https://example.com/api", "GET") // applied
        val rule = MockEngine.shared.getRules().first { it.id == id }
        assertEquals(1, rule.hitCount)
    }

    // MARK: - stopAfter

    @Test
    fun `stopAfter N applies the first N then stops forever`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(body = "M"), stopAfter = 2))
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET")) // applied 1
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET")) // applied 2
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // exhausted
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // stays exhausted
    }

    @Test
    fun `stopAfter zero with no skip never applies`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), stopAfter = 0))
        assertNull(MockEngine.shared.match("https://example.com/api", "GET"))
        assertNull(MockEngine.shared.match("https://example.com/api", "GET"))
    }

    @Test
    fun `stopAfter null is unlimited`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), stopAfter = null))
        repeat(25) {
            assertNotNull(MockEngine.shared.match("https://example.com/api", "GET"))
        }
    }

    // MARK: - skipCount + stopAfter interaction

    @Test
    fun `skip then stop boundary`() {
        MockEngine.shared.addRule(
            MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = 1, stopAfter = 2)
        )
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 1: skipped
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 2: applied #1
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 3: applied #2
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 4: exhausted
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // match 5: still exhausted
    }

    // MARK: - Budget resets on re-add

    @Test
    fun `re-adding a rule with the same id resets its skip-stop budget`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = 1, id = "r1"))
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // consumed the skip

        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = 1, id = "r1"))
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // budget restarted
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET"))
    }

    @Test
    fun `removing and re-adding the same id starts a fresh budget`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = 1, id = "r1"))
        MockEngine.shared.match("https://example.com/api", "GET")
        MockEngine.shared.removeRule("r1")
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = 1, id = "r1"))
        assertNull(MockEngine.shared.match("https://example.com/api", "GET"))
    }

    // MARK: - failure

    @Test
    fun `failure is carried through`() {
        MockEngine.shared.addRule(
            MockRuleInput(pattern = "/api", response = MockResponse(), failure = MockFailure(MockFailureCode.TIMEOUT))
        )
        val rule = MockEngine.shared.match("https://example.com/api", "GET")
        assertEquals(MockFailureCode.TIMEOUT, rule?.failure?.code)
    }

    @Test
    fun `failure honors skipCount`() {
        MockEngine.shared.addRule(
            MockRuleInput(
                pattern = "/api",
                response = MockResponse(),
                failure = MockFailure(MockFailureCode.CANNOT_FIND_HOST),
                skipCount = 1,
            )
        )
        assertNull(MockEngine.shared.match("https://example.com/api", "GET")) // skipped
        val rule = MockEngine.shared.match("https://example.com/api", "GET")
        assertEquals(MockFailureCode.CANNOT_FIND_HOST, rule?.failure?.code)
    }

    @Test
    fun `MockFailureCode wire values round-trip through fromWireValue`() {
        for (code in MockFailureCode.entries) {
            assertEquals(code, MockFailureCode.fromWireValue(code.wireValue))
        }
        assertNull(MockFailureCode.fromWireValue("meteorStrike"))
    }

    // MARK: - Hostile input at the engine level (negative/absurd values clamp, never crash)

    @Test
    fun `negative skipCount clamps to zero`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = -5))
        assertNotNull(MockEngine.shared.match("https://example.com/api", "GET"))
    }

    @Test
    fun `negative stopAfter clamps to zero`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), stopAfter = -5))
        assertNull(MockEngine.shared.match("https://example.com/api", "GET"))
    }

    @Test
    fun `absurdly large skipCount never applies within a reasonable window`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), skipCount = Int.MAX_VALUE))
        repeat(50) {
            assertNull(MockEngine.shared.match("https://example.com/api", "GET"))
        }
    }

    @Test
    fun `absurdly large stopAfter behaves as unlimited within a reasonable window`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/api", response = MockResponse(), stopAfter = Int.MAX_VALUE))
        repeat(50) {
            assertNotNull(MockEngine.shared.match("https://example.com/api", "GET"))
        }
    }
}
