package com.noodleapps.hakka

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull

class MockEngineNoopBehaviorTest {
    @Test
    fun `noop engine never installs or matches RN bridge rules`() {
        val response = MockResponse(
            headerValues = mapOf("Set-Cookie" to listOf("one=1", "two=2")),
        )
        val rule = MockRuleInput(
            pattern = "/orders",
            response = response,
            failure = MockFailure(MockFailureCode.TIMEOUT),
            skipCount = 1,
            stopAfter = 2,
        )

        assertNull(MockFailureCode.fromWireValue("not-a-code"))
        assertEquals("", MockEngine.shared.addRule(rule))
        assertEquals(emptyList<MockRule>(), MockEngine.shared.getRules())
        assertNull(MockEngine.shared.match("https://example.com/orders", "GET"))
    }
}
