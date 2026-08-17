package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * Unit tests for [ThrottleEngine].
 *
 * Covers:
 * - Default profile is NONE; engine is inactive.
 * - Profile selection resolves the correct latencyMs / downloadKbps from the preset table.
 * - Setting NONE resets to pass-through.
 * - OFFLINE profile is active but isOffline = true; downloadKbps = 0.
 * - Custom profile stores caller-supplied values.
 * - [delayForBytes]: formula correctness and edge cases (0 kbps, 0 bytes).
 */
class ThrottleEngineTest {

    private lateinit var engine: ThrottleEngine

    @BeforeEach
    fun setUp() {
        engine = ThrottleEngine()
    }

    // ── Default state ─────────────────────────────────────────────────────────

    @Test
    fun `default profile is NONE`() {
        assertEquals(ThrottleProfile.NONE, engine.config.profile)
    }

    @Test
    fun `isActive is false by default`() {
        assertFalse(engine.isActive)
    }

    @Test
    fun `isOffline is false by default`() {
        assertFalse(engine.isOffline)
    }

    // ── Profile selection — latency ───────────────────────────────────────────

    @Test
    fun `slow-3g profile has latency 400ms`() {
        engine.setProfile(ThrottleProfile.SLOW_3G)
        assertEquals(400L, engine.config.latencyMs)
    }

    @Test
    fun `fast-3g profile has latency 150ms`() {
        engine.setProfile(ThrottleProfile.FAST_3G)
        assertEquals(150L, engine.config.latencyMs)
    }

    @Test
    fun `edge profile has latency 250ms`() {
        engine.setProfile(ThrottleProfile.EDGE)
        assertEquals(250L, engine.config.latencyMs)
    }

    @Test
    fun `offline profile has latency 0ms`() {
        engine.setProfile(ThrottleProfile.OFFLINE)
        assertEquals(0L, engine.config.latencyMs)
    }

    // ── Profile selection — bandwidth ─────────────────────────────────────────

    @Test
    fun `slow-3g profile has bandwidth 400 kbps`() {
        engine.setProfile(ThrottleProfile.SLOW_3G)
        assertEquals(400L, engine.config.downloadKbps)
    }

    @Test
    fun `fast-3g profile has bandwidth 1500 kbps`() {
        engine.setProfile(ThrottleProfile.FAST_3G)
        assertEquals(1500L, engine.config.downloadKbps)
    }

    @Test
    fun `edge profile has bandwidth 240 kbps`() {
        engine.setProfile(ThrottleProfile.EDGE)
        assertEquals(240L, engine.config.downloadKbps)
    }

    @Test
    fun `offline profile has bandwidth 0 kbps`() {
        engine.setProfile(ThrottleProfile.OFFLINE)
        assertEquals(0L, engine.config.downloadKbps)
    }

    // ── isActive / isOffline flags ────────────────────────────────────────────

    @Test
    fun `isActive is true for non-none profile`() {
        engine.setProfile(ThrottleProfile.SLOW_3G)
        assertTrue(engine.isActive)
    }

    @Test
    fun `isActive is true for offline profile`() {
        engine.setProfile(ThrottleProfile.OFFLINE)
        assertTrue(engine.isActive)
    }

    @Test
    fun `isOffline is true for offline profile`() {
        engine.setProfile(ThrottleProfile.OFFLINE)
        assertTrue(engine.isOffline)
    }

    @Test
    fun `isOffline is false for slow-3g profile`() {
        engine.setProfile(ThrottleProfile.SLOW_3G)
        assertFalse(engine.isOffline)
    }

    @Test
    fun `setting NONE resets isActive to false`() {
        engine.setProfile(ThrottleProfile.SLOW_3G)
        assertTrue(engine.isActive) // sanity

        engine.setProfile(ThrottleProfile.NONE)
        assertFalse(engine.isActive)
    }

    @Test
    fun `setting NONE resets latency and bandwidth to 0`() {
        engine.setProfile(ThrottleProfile.SLOW_3G)
        engine.setProfile(ThrottleProfile.NONE)
        assertEquals(0L, engine.config.latencyMs)
        assertEquals(0L, engine.config.downloadKbps)
    }

    // ── Custom profile ────────────────────────────────────────────────────────

    @Test
    fun `setCustom stores caller-supplied latency and bandwidth`() {
        engine.setCustom(latencyMs = 999L, downloadKbps = 123L)
        assertEquals(ThrottleProfile.CUSTOM, engine.config.profile)
        assertEquals(999L, engine.config.latencyMs)
        assertEquals(123L, engine.config.downloadKbps)
    }

    @Test
    fun `setCustom with no bandwidth defaults to 0`() {
        engine.setCustom(latencyMs = 50L)
        assertEquals(0L, engine.config.downloadKbps)
    }

    // ── delayForBytes math ────────────────────────────────────────────────────

    /**
     * Formula: delay = byteCount / (kbps * 1024 / 8 / 1000)
     *   = byteCount / (kbps * 128 / 1000)
     *   = byteCount * 1000 / (kbps * 128)
     *
     * At 400 kbps, bytesPerMs = 400 * 1024 / 8 / 1000 = 51.2 bytes/ms
     * So 1024 bytes → 1024 / 51.2 = 20 ms
     */
    @Test
    fun `delayForBytes at 400kbps for 1024 bytes returns 20ms`() {
        engine.setProfile(ThrottleProfile.SLOW_3G) // 400 kbps
        val delay = engine.delayForBytes(1024L)
        assertEquals(20L, delay)
    }

    /**
     * At 1500 kbps, bytesPerMs = 1500 * 1024 / 8 / 1000 = 192 bytes/ms
     * 1920 bytes → 1920 / 192 = 10 ms
     */
    @Test
    fun `delayForBytes at 1500kbps for 1920 bytes returns 10ms`() {
        engine.setProfile(ThrottleProfile.FAST_3G) // 1500 kbps
        val delay = engine.delayForBytes(1920L)
        assertEquals(10L, delay)
    }

    /**
     * At 240 kbps, bytesPerMs = 240 * 1024 / 8 / 1000 = 30.72 bytes/ms
     * 3072 bytes → 3072 / 30.72 = 100 ms
     */
    @Test
    fun `delayForBytes at 240kbps for 3072 bytes returns 100ms`() {
        engine.setProfile(ThrottleProfile.EDGE) // 240 kbps
        val delay = engine.delayForBytes(3072L)
        assertEquals(100L, delay)
    }

    @Test
    fun `delayForBytes returns 0 when downloadKbps is 0`() {
        engine.setProfile(ThrottleProfile.OFFLINE) // kbps = 0
        assertEquals(0L, engine.delayForBytes(1_000_000L))
    }

    @Test
    fun `delayForBytes returns 0 for 0 bytes`() {
        engine.setProfile(ThrottleProfile.SLOW_3G)
        assertEquals(0L, engine.delayForBytes(0L))
    }

    @Test
    fun `delayForBytes returns 0 when profile is NONE`() {
        // Engine is in default (NONE) state → kbps = 0
        assertEquals(0L, engine.delayForBytes(1024L))
    }

    @Test
    fun `delayForBytes is non-negative for any positive input`() {
        engine.setCustom(latencyMs = 0L, downloadKbps = 1L)
        val delay = engine.delayForBytes(1L)
        assertTrue(delay >= 0L)
    }
}
