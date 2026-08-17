package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * [isErrorSeverityRow] is the pure predicate half of the row-severity-grammar
 * decision: error/5xx rows get the stripe PLUS a background tint; 4xx stays
 * stripe-only. Kept free of Android color calls specifically so it's testable
 * without Robolectric, like the rest of hakka-ui's suite.
 */
class FormattersTest {

    @Test
    fun `5xx status is an error-severity row`() {
        assertTrue(isErrorSeverityRow(status = 500, hasError = false))
        assertTrue(isErrorSeverityRow(status = 503, hasError = false))
    }

    @Test
    fun `a captured error is an error-severity row even with no status`() {
        assertTrue(isErrorSeverityRow(status = null, hasError = true))
    }

    @Test
    fun `4xx status alone is NOT an error-severity row - stripe only`() {
        assertFalse(isErrorSeverityRow(status = 404, hasError = false))
        assertFalse(isErrorSeverityRow(status = 429, hasError = false))
    }

    @Test
    fun `2xx, 3xx, and pending are not error-severity rows`() {
        assertFalse(isErrorSeverityRow(status = 200, hasError = false))
        assertFalse(isErrorSeverityRow(status = 301, hasError = false))
        assertFalse(isErrorSeverityRow(status = null, hasError = false))
    }
}
