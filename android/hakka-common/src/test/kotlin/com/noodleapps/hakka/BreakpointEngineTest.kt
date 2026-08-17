package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Unit tests for [BreakpointEngine] state machine.
 *
 * Covers:
 * - rule matching (url, method, phase, enabled flag)
 * - request-phase pause / resume / abort / edit
 * - response-phase pause / resume / edit / abort
 * - pass-through when no rule matches
 * - multiple concurrent paused requests
 * - resumeAll clears all pending entries
 * - engine-level enabled flag
 * - subscribe / notify
 */
class BreakpointEngineTest {

    private lateinit var engine: BreakpointEngine

    @BeforeEach
    fun setUp() {
        engine = BreakpointEngine()
        engine.enabled = true
    }

    // ── Rule CRUD ─────────────────────────────────────────────────────────────

    @Test
    fun `addBreakpoint returns generated id`() {
        val id = engine.addBreakpoint(BreakpointRuleInput(pattern = "/api"))
        assertTrue(id.startsWith("bp_"))
    }

    @Test
    fun `addBreakpoint honours caller-supplied id`() {
        val id = engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", id = "my-id"))
        assertEquals("my-id", id)
        assertEquals(1, engine.getBreakpoints().size)
        assertEquals("my-id", engine.getBreakpoints()[0].id)
    }

    @Test
    fun `addBreakpoint with a duplicate id replaces the rule in place, not a duplicate`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/first", on = BreakpointPhase.REQUEST, id = "dup"))
        engine.addBreakpoint(
            BreakpointRuleInput(pattern = "/second", on = BreakpointPhase.RESPONSE, enabled = false, id = "dup")
        )

        val matches = engine.getBreakpoints().filter { it.id == "dup" }
        assertEquals(1, matches.size)
        assertEquals("/second", matches.first().pattern)
        assertEquals(BreakpointPhase.RESPONSE, matches.first().on)
        assertFalse(matches.first().enabled)
    }

    @Test
    fun `replace-by-id preserves rule position`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/a", id = "a"))
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/b", id = "b"))
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/c", id = "c"))

        engine.addBreakpoint(BreakpointRuleInput(pattern = "/b-replaced", id = "b"))

        val ids = engine.getBreakpoints().map { it.id }
        assertEquals(listOf("a", "b", "c"), ids)
        assertEquals("/b-replaced", engine.getBreakpoints()[1].pattern)
    }

    @Test
    fun `removeBreakpoint removes the rule`() {
        val id = engine.addBreakpoint(BreakpointRuleInput(pattern = "/api"))
        engine.removeBreakpoint(id)
        assertTrue(engine.getBreakpoints().isEmpty())
    }

    @Test
    fun `removeBreakpoint is idempotent for unknown id`() {
        engine.removeBreakpoint("no-such-id") // must not throw
        assertTrue(engine.getBreakpoints().isEmpty())
    }

    @Test
    fun `setEnabled toggles rule enabled flag`() {
        val id = engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", enabled = true))
        engine.setEnabled(id, false)
        assertFalse(engine.getBreakpoints()[0].enabled)
        engine.setEnabled(id, true)
        assertTrue(engine.getBreakpoints()[0].enabled)
    }

    @Test
    fun `clearBreakpoints removes all rules`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/a"))
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/b"))
        engine.clearBreakpoints()
        assertTrue(engine.getBreakpoints().isEmpty())
    }

    @Test
    fun `getBreakpoints returns a snapshot not a live reference`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api"))
        val snap1 = engine.getBreakpoints()
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/v2"))
        val snap2 = engine.getBreakpoints()
        assertEquals(1, snap1.size)
        assertEquals(2, snap2.size)
    }

    // ── Matching ──────────────────────────────────────────────────────────────

    @Test
    fun `matches returns false when engine disabled`() {
        engine.enabled = false
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", on = BreakpointPhase.REQUEST))
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
    }

    @Test
    fun `matches returns false when no rules`() {
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
    }

    @Test
    fun `matches returns false when rule disabled`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", enabled = false))
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
    }

    @Test
    fun `matches url substring`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api/users"))
        assertTrue(engine.matches("https://example.com/api/users/123", "GET", BreakpointPhase.REQUEST))
        assertFalse(engine.matches("https://example.com/api/posts", "GET", BreakpointPhase.REQUEST))
    }

    @Test
    fun `matches with method filter case-insensitive`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", method = "POST"))
        assertTrue(engine.matches("https://example.com/api", "POST", BreakpointPhase.REQUEST))
        assertTrue(engine.matches("https://example.com/api", "post", BreakpointPhase.REQUEST))
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
    }

    @Test
    fun `matches null method filter passes all methods`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", method = null))
        assertTrue(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
        assertTrue(engine.matches("https://example.com/api", "DELETE", BreakpointPhase.REQUEST))
    }

    @Test
    fun `matches request phase on REQUEST rule`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", on = BreakpointPhase.REQUEST))
        assertTrue(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.RESPONSE))
    }

    @Test
    fun `matches response phase on RESPONSE rule`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", on = BreakpointPhase.RESPONSE))
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
        assertTrue(engine.matches("https://example.com/api", "GET", BreakpointPhase.RESPONSE))
    }

    @Test
    fun `BOTH rule matches request and response phase`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", on = BreakpointPhase.BOTH))
        assertTrue(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
        assertTrue(engine.matches("https://example.com/api", "GET", BreakpointPhase.RESPONSE))
    }

    @Test
    fun `pass-through when url does not match any rule`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api"))
        assertFalse(engine.matches("https://example.com/health", "GET", BreakpointPhase.REQUEST))
    }

    // ── Request-phase pause / resume ──────────────────────────────────────────

    @Test
    fun `pauseRequest blocks until resumeRequest is called`() {
        val snapshot = PausedRequest("https://example.com/api", "GET", emptyMap(), null)
        val resultRef = AtomicReference<ResumeRequestAction>()
        val pauseLatch = CountDownLatch(1)
        val doneLatch = CountDownLatch(1)

        val pool = Executors.newSingleThreadExecutor()
        pool.submit {
            pauseLatch.countDown()
            resultRef.set(engine.pauseRequest("req-1", snapshot))
            doneLatch.countDown()
        }

        pauseLatch.await(1, TimeUnit.SECONDS)
        // Give the background thread a moment to enter take()
        Thread.sleep(50)

        val pauseId = engine.getPaused().first().id
        engine.resumeRequest(pauseId, null)

        assertTrue(doneLatch.await(2, TimeUnit.SECONDS), "pauseRequest did not unblock")
        assertInstanceOf(ResumeRequestAction.Resume::class.java, resultRef.get())
        assertNull((resultRef.get() as ResumeRequestAction.Resume).edits)
        assertTrue(engine.getPaused().isEmpty())
        pool.shutdown()
    }

    @Test
    fun `pauseRequest returns edits when provided`() {
        val snapshot = PausedRequest("https://example.com/api", "GET", emptyMap(), null)
        val edits = PausedRequestEdits(url = "https://example.com/api/v2", headers = mapOf("X-Test" to "1"))
        val resultRef = AtomicReference<ResumeRequestAction>()
        val doneLatch = CountDownLatch(1)

        val pool = Executors.newSingleThreadExecutor()
        pool.submit {
            resultRef.set(engine.pauseRequest("req-2", snapshot))
            doneLatch.countDown()
        }
        Thread.sleep(50)

        val pauseId = engine.getPaused().first().id
        engine.resumeRequest(pauseId, edits)

        assertTrue(doneLatch.await(2, TimeUnit.SECONDS))
        val action = resultRef.get() as ResumeRequestAction.Resume
        assertEquals("https://example.com/api/v2", action.edits?.url)
        assertEquals("1", action.edits?.headers?.get("X-Test"))
        pool.shutdown()
    }

    @Test
    fun `abort resolves request pause with Abort action`() {
        val snapshot = PausedRequest("https://example.com/api", "GET", emptyMap(), null)
        val resultRef = AtomicReference<ResumeRequestAction>()
        val doneLatch = CountDownLatch(1)

        val pool = Executors.newSingleThreadExecutor()
        pool.submit {
            resultRef.set(engine.pauseRequest("req-3", snapshot))
            doneLatch.countDown()
        }
        Thread.sleep(50)

        val pauseId = engine.getPaused().first().id
        engine.abort(pauseId)

        assertTrue(doneLatch.await(2, TimeUnit.SECONDS))
        assertInstanceOf(ResumeRequestAction.Abort::class.java, resultRef.get())
        assertTrue(engine.getPaused().isEmpty())
        pool.shutdown()
    }

    // ── Response-phase pause / resume ─────────────────────────────────────────

    @Test
    fun `pauseResponse blocks until resumeResponse is called`() {
        val snapshot = PausedResponse(200, mapOf("Content-Type" to "application/json"), "{}")
        val resultRef = AtomicReference<ResumeResponseAction>()
        val doneLatch = CountDownLatch(1)

        val pool = Executors.newSingleThreadExecutor()
        pool.submit {
            resultRef.set(engine.pauseResponse("req-4", snapshot))
            doneLatch.countDown()
        }
        Thread.sleep(50)

        val pauseId = engine.getPaused().first().id
        engine.resumeResponse(pauseId, null)

        assertTrue(doneLatch.await(2, TimeUnit.SECONDS))
        assertInstanceOf(ResumeResponseAction.Resume::class.java, resultRef.get())
        assertNull((resultRef.get() as ResumeResponseAction.Resume).edits)
        pool.shutdown()
    }

    @Test
    fun `pauseResponse returns edits when provided`() {
        val snapshot = PausedResponse(200, emptyMap(), "{}")
        val edits = PausedResponseEdits(status = 500, body = """{"error":"injected"}""")
        val resultRef = AtomicReference<ResumeResponseAction>()
        val doneLatch = CountDownLatch(1)

        val pool = Executors.newSingleThreadExecutor()
        pool.submit {
            resultRef.set(engine.pauseResponse("req-5", snapshot))
            doneLatch.countDown()
        }
        Thread.sleep(50)

        val pauseId = engine.getPaused().first().id
        engine.resumeResponse(pauseId, edits)

        assertTrue(doneLatch.await(2, TimeUnit.SECONDS))
        val action = resultRef.get() as ResumeResponseAction.Resume
        assertEquals(500, action.edits?.status)
        assertEquals("""{"error":"injected"}""", action.edits?.body)
        pool.shutdown()
    }

    @Test
    fun `abort resolves response pause with Abort action`() {
        val snapshot = PausedResponse(200, emptyMap(), "{}")
        val resultRef = AtomicReference<ResumeResponseAction>()
        val doneLatch = CountDownLatch(1)

        val pool = Executors.newSingleThreadExecutor()
        pool.submit {
            resultRef.set(engine.pauseResponse("req-6", snapshot))
            doneLatch.countDown()
        }
        Thread.sleep(50)

        val pauseId = engine.getPaused().first().id
        engine.abort(pauseId)

        assertTrue(doneLatch.await(2, TimeUnit.SECONDS))
        assertInstanceOf(ResumeResponseAction.Abort::class.java, resultRef.get())
        pool.shutdown()
    }

    // ── Multiple concurrent paused requests ───────────────────────────────────

    @Test
    fun `multiple concurrent paused requests are tracked independently`() {
        val snap1 = PausedRequest("https://example.com/api/a", "GET", emptyMap(), null)
        val snap2 = PausedRequest("https://example.com/api/b", "POST", emptyMap(), "{}")
        val snap3 = PausedResponse(200, emptyMap(), "ok")

        val pool = Executors.newFixedThreadPool(3)
        val readyLatch = CountDownLatch(3)
        val doneLatch = CountDownLatch(3)

        val result1 = AtomicReference<ResumeRequestAction>()
        val result2 = AtomicReference<ResumeRequestAction>()
        val result3 = AtomicReference<ResumeResponseAction>()

        pool.submit { readyLatch.countDown(); result1.set(engine.pauseRequest("r1", snap1)); doneLatch.countDown() }
        pool.submit { readyLatch.countDown(); result2.set(engine.pauseRequest("r2", snap2)); doneLatch.countDown() }
        pool.submit { readyLatch.countDown(); result3.set(engine.pauseResponse("r3", snap3)); doneLatch.countDown() }

        readyLatch.await(1, TimeUnit.SECONDS)
        Thread.sleep(100) // let all three hit take()

        val paused = engine.getPaused()
        assertEquals(3, paused.size)

        val reqPaused = paused.filter { it.phase == PausedPhase.REQUEST }
        val respPaused = paused.filter { it.phase == PausedPhase.RESPONSE }
        assertEquals(2, reqPaused.size)
        assertEquals(1, respPaused.size)

        // Resolve each independently
        val edits1 = PausedRequestEdits(url = "https://example.com/api/a-edited")
        engine.resumeRequest(reqPaused.first { it.requestId == "r1" }.id, edits1)
        engine.abort(reqPaused.first { it.requestId == "r2" }.id)
        engine.resumeResponse(respPaused[0].id, PausedResponseEdits(status = 204))

        assertTrue(doneLatch.await(3, TimeUnit.SECONDS))

        assertEquals("https://example.com/api/a-edited", (result1.get() as ResumeRequestAction.Resume).edits?.url)
        assertInstanceOf(ResumeRequestAction.Abort::class.java, result2.get())
        assertEquals(204, (result3.get() as ResumeResponseAction.Resume).edits?.status)

        assertTrue(engine.getPaused().isEmpty())
        pool.shutdown()
    }

    // ── resumeAll ─────────────────────────────────────────────────────────────

    @Test
    fun `resumeAll unblocks all paused requests without edits`() {
        val pool = Executors.newFixedThreadPool(4)
        val readyLatch = CountDownLatch(4)
        val doneLatch = CountDownLatch(4)

        repeat(3) { i ->
            pool.submit {
                readyLatch.countDown()
                engine.pauseRequest("req-all-$i", PausedRequest("https://example.com/$i", "GET", emptyMap(), null))
                doneLatch.countDown()
            }
        }
        pool.submit {
            readyLatch.countDown()
            engine.pauseResponse("req-all-3", PausedResponse(200, emptyMap(), "{}"))
            doneLatch.countDown()
        }

        readyLatch.await(1, TimeUnit.SECONDS)
        Thread.sleep(100)
        assertEquals(4, engine.getPaused().size)

        engine.resumeAll()

        assertTrue(doneLatch.await(3, TimeUnit.SECONDS), "resumeAll did not unblock all")
        assertTrue(engine.getPaused().isEmpty())
        pool.shutdown()
    }

    // ── hasPaused / getPaused state ────────────────────────────────────────────

    @Test
    fun `hasPaused reflects current state`() {
        assertFalse(engine.hasPaused())

        val pool = Executors.newSingleThreadExecutor()
        val readyLatch = CountDownLatch(1)
        val doneLatch = CountDownLatch(1)
        pool.submit {
            readyLatch.countDown()
            engine.pauseRequest("r", PausedRequest("https://example.com/api", "GET", emptyMap(), null))
            doneLatch.countDown()
        }
        readyLatch.await(1, TimeUnit.SECONDS)
        Thread.sleep(50)

        assertTrue(engine.hasPaused())
        val pauseId = engine.getPaused().first().id
        engine.resumeRequest(pauseId)

        doneLatch.await(2, TimeUnit.SECONDS)
        assertFalse(engine.hasPaused())
        pool.shutdown()
    }

    @Test
    fun `getPaused entry holds correct snapshot for request phase`() {
        val snap = PausedRequest("https://example.com/api", "POST", mapOf("Authorization" to "Bearer tok"), "body")
        val pool = Executors.newSingleThreadExecutor()
        val readyLatch = CountDownLatch(1)
        pool.submit {
            readyLatch.countDown()
            engine.pauseRequest("req-snap", snap)
        }
        readyLatch.await(1, TimeUnit.SECONDS)
        Thread.sleep(50)

        val entry = engine.getPaused().first()
        assertEquals(PausedPhase.REQUEST, entry.phase)
        assertEquals("req-snap", entry.requestId)
        assertEquals("https://example.com/api", entry.request?.url)
        assertEquals("POST", entry.request?.method)
        assertEquals("tok", entry.request?.headers?.get("Authorization")?.removePrefix("Bearer "))
        assertNull(entry.response)

        engine.resumeRequest(entry.id)
        pool.shutdown()
    }

    @Test
    fun `getPaused entry holds correct snapshot for response phase`() {
        val snap = PausedResponse(404, mapOf("Content-Type" to "application/json"), """{"error":"not found"}""")
        val pool = Executors.newSingleThreadExecutor()
        val readyLatch = CountDownLatch(1)
        pool.submit {
            readyLatch.countDown()
            engine.pauseResponse("req-resp-snap", snap)
        }
        readyLatch.await(1, TimeUnit.SECONDS)
        Thread.sleep(50)

        val entry = engine.getPaused().first()
        assertEquals(PausedPhase.RESPONSE, entry.phase)
        assertEquals("req-resp-snap", entry.requestId)
        assertNull(entry.request)
        assertEquals(404, entry.response?.status)
        assertEquals("""{"error":"not found"}""", entry.response?.body)

        engine.resumeResponse(entry.id)
        pool.shutdown()
    }

    // ── subscribe / notify ─────────────────────────────────────────────────────

    @Test
    fun `subscribe fires on rule add`() {
        var callCount = 0
        engine.subscribe { callCount++ }
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api"))
        assertEquals(1, callCount)
    }

    @Test
    fun `subscribe fires on rule remove`() {
        var callCount = 0
        val id = engine.addBreakpoint(BreakpointRuleInput(pattern = "/api"))
        engine.subscribe { callCount++ }
        engine.removeBreakpoint(id)
        assertEquals(1, callCount)
    }

    @Test
    fun `unsubscribe stops notifications`() {
        var callCount = 0
        val unsub = engine.subscribe { callCount++ }
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/a"))
        unsub()
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/b"))
        assertEquals(1, callCount) // only first add notified
    }

    // ── Edge cases ────────────────────────────────────────────────────────────

    @Test
    fun `resumeRequest with unknown pauseId is a no-op`() {
        engine.resumeRequest("no-such-pause-id") // must not throw
    }

    @Test
    fun `resumeResponse with unknown pauseId is a no-op`() {
        engine.resumeResponse("no-such-pause-id")
    }

    @Test
    fun `abort with unknown pauseId is a no-op`() {
        engine.abort("no-such-pause-id")
    }

    @Test
    fun `rule with empty pattern matches every url`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = ""))
        // empty string is contained in every string
        assertTrue(engine.matches("https://example.com/anything", "GET", BreakpointPhase.REQUEST))
    }

    @Test
    fun `disabled engine does not match even with matching rules`() {
        engine.addBreakpoint(BreakpointRuleInput(pattern = "/api", on = BreakpointPhase.BOTH))
        engine.enabled = false
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.REQUEST))
        assertFalse(engine.matches("https://example.com/api", "GET", BreakpointPhase.RESPONSE))
    }
}
