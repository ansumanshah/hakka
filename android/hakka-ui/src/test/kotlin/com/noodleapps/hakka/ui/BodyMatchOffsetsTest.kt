package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class BodyMatchOffsetsTest {
    @Test
    fun `Unicode case conversion cannot shift a later highlight`() {
        assertEquals(listOf(1, 4), findBodyMatchOffsets("İx ·X", "x"))
    }

    @Test
    fun `surrogate pairs preserve text layout offsets`() {
        assertEquals(listOf(3, 10), findBodyMatchOffsets("😀 GET 😀 get", "GET"))
    }
}
