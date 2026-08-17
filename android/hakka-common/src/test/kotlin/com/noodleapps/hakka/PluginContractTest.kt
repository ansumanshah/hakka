package com.noodleapps.hakka

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

/**
 * Tests for the [HakkaPlugin] and [HakkaPluginContext] contracts defined in hakka-common.
 *
 * Verifies that the interface shapes compile and behave correctly for consumer code that
 * depends only on hakka-common (not on hakka-network or Android).
 */
class PluginContractTest {

    // ── HakkaPlugin interface ────────────────────────────────────────────────

    @Test
    fun `plugin setup defaults to null teardown`() {
        val plugin = object : HakkaPlugin {
            override val id = "test"
        }
        val ctx = noopContext()
        val teardown = plugin.setup(ctx)
        assertNull(teardown, "default setup should return null (no teardown)")
    }

    @Test
    fun `plugin setup can return a teardown lambda`() {
        var tornDown = false
        val plugin = object : HakkaPlugin {
            override val id = "teardown-plugin"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit) = { tornDown = true }
        }
        val teardown = plugin.setup(noopContext())
        assertNotNull(teardown)
        assertFalse(tornDown)
        teardown!!()
        assertTrue(tornDown)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun noopContext(): HakkaPluginContext = object : HakkaPluginContext {
        override fun ingest(request: NetworkRequest) = Unit
        override fun update(id: String, transform: (NetworkRequest) -> NetworkRequest): Boolean = false
        override fun onRequest(listener: (NetworkRequest) -> Unit): () -> Unit = { }
        override fun getLogs(): List<NetworkRequest> = emptyList()
        override fun registerSink(sink: RecordSink): () -> Unit = { }
    }
}
