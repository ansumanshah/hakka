package com.noodleapps.hakka

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/**
 * Unit tests for [PluginRegistry] + [HakkaPluginContextImpl].
 *
 * Covers:
 * - idempotent registration (same id → no-op on second call)
 * - ordering preserved (plugins returned in registration order)
 * - setup called once per plugin
 * - teardown invoked on [PluginRegistry.remove] and [PluginRegistry.removeAll]
 * - [HakkaPluginContextImpl.onRequest] subscriber lifecycle
 * - [HakkaPluginContextImpl.registerSink] subscription lifecycle
 * - [HakkaPluginContextImpl.getLogs] returns newest-first snapshot
 * - [HakkaPluginContextImpl.update] returns false for unknown id
 * - exception in setup doesn't prevent registration
 * - exception in teardown doesn't prevent subsequent teardowns
 */
class PluginRegistryTest {

    private lateinit var logStore: LogStore
    private lateinit var sinkHub: RecordSinkHub
    private lateinit var pluginListeners: CopyOnWriteArrayList<(NetworkRequest) -> Unit>
    private lateinit var registry: PluginRegistry
    private val ingested = mutableListOf<NetworkRequest>()

    @BeforeEach
    fun setUp() {
        logStore = LogStore(HakkaConfig(maxRequests = 100))
        sinkHub = RecordSinkHub()
        pluginListeners = CopyOnWriteArrayList()
        registry = PluginRegistry {
            HakkaPluginContextImpl(
                logStore = logStore,
                sinkHub = sinkHub,
                onIngest = { req -> ingested.add(req); logStore.add(req) },
                requestListeners = pluginListeners,
            )
        }
    }

    // ── Registration ────────────────────────────────────────────────────────

    @Test
    fun `use registers a plugin and returns true`() {
        val plugin = simplePlugin("p1")
        assertTrue(registry.use(plugin))
        assertEquals(listOf(plugin), registry.registeredPlugins())
    }

    @Test
    fun `use is idempotent per plugin id`() {
        val p1a = simplePlugin("p1")
        val p1b = simplePlugin("p1") // same id, different instance
        assertTrue(registry.use(p1a))
        assertFalse(registry.use(p1b))
        assertEquals(1, registry.registeredPlugins().size)
        assertSame(p1a, registry.registeredPlugins().first())
    }

    @Test
    fun `multiple plugins are stored in registration order`() {
        val p1 = simplePlugin("p1")
        val p2 = simplePlugin("p2")
        val p3 = simplePlugin("p3")
        registry.use(p1); registry.use(p2); registry.use(p3)
        assertEquals(listOf(p1, p2, p3), registry.registeredPlugins())
    }

    @Test
    fun `setup is called exactly once per plugin`() {
        val setupCount = AtomicInteger(0)
        val plugin = object : HakkaPlugin {
            override val id = "counted"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                setupCount.incrementAndGet()
                return null
            }
        }
        registry.use(plugin)
        registry.use(plugin) // idempotent — setup must not be called again
        assertEquals(1, setupCount.get())
    }

    // ── Removal ─────────────────────────────────────────────────────────────

    @Test
    fun `remove invokes teardown and returns true`() {
        var tornDown = false
        val plugin = object : HakkaPlugin {
            override val id = "teardown-test"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit) = { tornDown = true }
        }
        registry.use(plugin)
        assertFalse(tornDown)
        assertTrue(registry.remove("teardown-test"))
        assertTrue(tornDown)
        assertTrue(registry.registeredPlugins().isEmpty())
    }

    @Test
    fun `remove returns false for unknown plugin id`() {
        assertFalse(registry.remove("nonexistent"))
    }

    @Test
    fun `removeAll invokes all teardowns`() {
        val counts = mutableMapOf<String, Int>()
        fun makeTeardownPlugin(id: String) = object : HakkaPlugin {
            override val id = id
            override fun setup(ctx: HakkaPluginContext): (() -> Unit) = {
                counts[this.id] = (counts[this.id] ?: 0) + 1
            }
        }
        registry.use(makeTeardownPlugin("a"))
        registry.use(makeTeardownPlugin("b"))
        registry.use(makeTeardownPlugin("c"))
        registry.removeAll()
        assertEquals(mapOf("a" to 1, "b" to 1, "c" to 1), counts)
        assertTrue(registry.registeredPlugins().isEmpty())
    }

    @Test
    fun `removeAll is safe when registry is empty`() {
        assertDoesNotThrow { registry.removeAll() }
    }

    @Test
    fun `exception in teardown does not prevent subsequent teardowns`() {
        val secondTornDown = mutableListOf<String>()
        registry.use(object : HakkaPlugin {
            override val id = "bad-teardown"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit) = { error("intentional") }
        })
        registry.use(object : HakkaPlugin {
            override val id = "good-teardown"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit) = { secondTornDown.add("ran") }
        })
        assertDoesNotThrow { registry.removeAll() }
        assertEquals(listOf("ran"), secondTornDown)
    }

    // ── HakkaPluginContextImpl ───────────────────────────────────────────────

    @Test
    fun `context ingest adds request to log store`() {
        val req = makeRequest("ctx-ingest")
        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "ingest-plugin"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx; return null
            }
        })
        contextRef!!.ingest(req)
        assertEquals(1, logStore.size())
        assertEquals(req.id, logStore.get(req.id)?.id)
    }

    @Test
    fun `context getLogs returns newest-first snapshot`() {
        val r1 = makeRequest("r1")
        val r2 = makeRequest("r2")
        logStore.add(r1)
        logStore.add(r2)

        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "log-plugin"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx; return null
            }
        })
        val logs = contextRef!!.getLogs()
        assertEquals(2, logs.size)
        assertEquals("r2", logs[0].id) // newest first
        assertEquals("r1", logs[1].id)
    }

    @Test
    fun `context update returns false for unknown id`() {
        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "update-plugin"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx; return null
            }
        })
        assertFalse(contextRef!!.update("no-such-id") { it })
    }

    @Test
    fun `context update transforms existing request`() {
        val req = makeRequest("upd-1")
        logStore.add(req)

        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "update-real"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx; return null
            }
        })

        val result = contextRef!!.update("upd-1") { it.copy(status = 404) }
        assertTrue(result)
        assertEquals(404, logStore.get("upd-1")?.status)
    }

    @Test
    fun `context onRequest listener receives captured requests`() {
        val received = mutableListOf<NetworkRequest>()
        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "listener-plugin"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx
                ctx.onRequest { received.add(it) }
                return null
            }
        })

        val req = makeRequest("evt-1")
        // Simulate a request being dispatched through plugin listeners
        pluginListeners.forEach { it(req) }

        assertEquals(1, received.size)
        assertEquals("evt-1", received[0].id)
    }

    @Test
    fun `context onRequest unsubscribe stops delivery`() {
        val received = mutableListOf<NetworkRequest>()
        var unsub: (() -> Unit)? = null
        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "unsub-plugin"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx
                unsub = ctx.onRequest { received.add(it) }
                return null
            }
        })

        val r1 = makeRequest("u1")
        pluginListeners.forEach { it(r1) }
        assertEquals(1, received.size)

        unsub!!()
        val r2 = makeRequest("u2")
        pluginListeners.forEach { it(r2) }
        assertEquals(1, received.size) // still 1 — listener was removed
    }

    @Test
    fun `context registerSink delivers records`() {
        val delivered = mutableListOf<ContractRecord>()
        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "sink-plugin"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx
                ctx.registerSink { delivered.add(it) }
                return null
            }
        })

        val record = BreadcrumbRecord(timestampMs = 1_000L, name = "test-crumb")
        sinkHub.emit(record)
        sinkHub.flush()

        assertEquals(1, delivered.size)
        assertEquals("test-crumb", (delivered[0] as BreadcrumbRecord).name)
    }

    @Test
    fun `context registerSink unregister stops delivery`() {
        val delivered = mutableListOf<ContractRecord>()
        var unreg: (() -> Unit)? = null
        var contextRef: HakkaPluginContext? = null
        registry.use(object : HakkaPlugin {
            override val id = "sink-unreg"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                contextRef = ctx
                unreg = ctx.registerSink { delivered.add(it) }
                return null
            }
        })

        val r1 = BreadcrumbRecord(timestampMs = 1_000L, name = "crumb-1")
        sinkHub.emit(r1); sinkHub.flush()
        assertEquals(1, delivered.size)

        unreg!!()
        val r2 = BreadcrumbRecord(timestampMs = 2_000L, name = "crumb-2")
        sinkHub.emit(r2); sinkHub.flush()
        assertEquals(1, delivered.size) // no new delivery
    }

    // ── Exception safety ────────────────────────────────────────────────────

    @Test
    fun `exception in setup does not prevent registration`() {
        val badPlugin = object : HakkaPlugin {
            override val id = "bad-setup"
            override fun setup(ctx: HakkaPluginContext): (() -> Unit)? {
                throw RuntimeException("intentional setup failure")
            }
        }
        assertDoesNotThrow { registry.use(badPlugin) }
        assertEquals(1, registry.registeredPlugins().size)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun simplePlugin(id: String): HakkaPlugin = object : HakkaPlugin {
        override val id = id
    }

    private fun makeRequest(id: String) = NetworkRequest(
        id = id,
        url = "https://example.com/api/$id",
        method = HttpMethod.GET,
        status = 200,
        startTimeMs = System.currentTimeMillis(),
        durationMs = 10L,
        requestHeaders = emptyMap(),
        responseHeaders = emptyMap(),
        requestBodySize = 0,
        responseBodySize = 50,
        requestBody = null,
        responseBody = null,
        error = null,
        source = RequestSource.OKHTTP,
    )
}
