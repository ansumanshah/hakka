package com.noodleapps.hakka

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * `breakpoint.paused` / `.resume` / `.abort` — the Kotlin mirror of the
 * corresponding section in `packages/hakka-core/src/engine/__tests__/control.test.ts`
 * and `ios/Tests/HakkaTests/ControlCommandBreakpointPause{Parsing,Apply}Tests.swift`.
 * Fixture-backed cases read the pinned JSON in `fixtures/control/` so a shape
 * drift here fails the TS and Swift tests too.
 */
class ControlCommandBreakpointPauseTest {

    @AfterEach
    fun tearDown() {
        BreakpointEngine.shared.clearBreakpoints()
        BreakpointEngine.shared.enabled = false
    }

    private fun json(text: String): JSONObject = JSONObject(text)

    // ── parse: valid shapes ─────────────────────────────────────────────────

    @Test
    fun `parses breakpoint-paused response phase from the pinned fixture`() {
        val cmd = parseControlCommand(ControlFixtures.readJSON("breakpoint-paused.json"))
        assertNotNull(cmd)
        val paused = cmd as ControlCommand.BreakpointPaused
        assertEquals("pause_7", paused.pauseId)
        assertEquals("bp-checkout", paused.ruleId)
        assertEquals("response", paused.phase)
        assertEquals("ios-simulator-6", paused.device)
        assertEquals("https://api.example.com/checkout", paused.request.url)
        assertEquals("POST", paused.request.method)
        assertEquals("application/json", paused.request.headers["accept"])
        assertEquals(200, paused.response?.status)
        assertEquals("{\"ok\":true}", paused.response?.body)
    }

    @Test
    fun `parses breakpoint-paused request phase without a response block`() {
        val cmd = parseControlCommand(
            json(
                """
                {"kind":"breakpoint.paused","pauseId":"pause_2","phase":"request","device":"android-emulator",
                 "request":{"url":"https://api.example.com/x","method":"POST","headers":{},"body":"{}"}}
                """.trimIndent()
            )
        )
        assertNotNull(cmd)
        val paused = cmd as ControlCommand.BreakpointPaused
        assertNull(paused.ruleId)
        assertEquals("request", paused.phase)
        assertNull(paused.response)
        assertEquals("{}", paused.request.body)
    }

    @Test
    fun `parses breakpoint-resume request edits from the pinned fixture`() {
        val cmd = parseControlCommand(ControlFixtures.readJSON("breakpoint-resume-request.json"))
        assertNotNull(cmd)
        val resume = cmd as ControlCommand.BreakpointResume
        assertEquals("pause_3", resume.pauseId)
        assertEquals("https://api.example.com/checkout?debug=1", resume.requestEdits?.url)
        assertEquals("POST", resume.requestEdits?.method)
        assertEquals("1", resume.requestEdits?.headers?.get("x-injected"))
        assertNull(resume.responseEdits)
    }

    @Test
    fun `parses breakpoint-resume response edits from the pinned fixture`() {
        val cmd = parseControlCommand(ControlFixtures.readJSON("breakpoint-resume-response.json"))
        assertNotNull(cmd)
        val resume = cmd as ControlCommand.BreakpointResume
        assertEquals("pause_7", resume.pauseId)
        assertNull(resume.requestEdits)
        assertEquals(201, resume.responseEdits?.status)
        assertEquals("1", resume.responseEdits?.headers?.get("x-injected"))
    }

    @Test
    fun `parses breakpoint-resume with no edits at all`() {
        val cmd = parseControlCommand(json("""{"kind":"breakpoint.resume","pauseId":"pause_9"}"""))
        assertNotNull(cmd)
        val resume = cmd as ControlCommand.BreakpointResume
        assertNull(resume.requestEdits)
        assertNull(resume.responseEdits)
    }

    @Test
    fun `parses breakpoint-abort from the pinned fixture`() {
        val cmd = parseControlCommand(ControlFixtures.readJSON("breakpoint-abort.json"))
        assertNotNull(cmd)
        assertEquals("pause_7", (cmd as ControlCommand.BreakpointAbort).pauseId)
    }

    // ── parse: hostile / malformed — missing field, wrong type, empty id, oversized, unknown phase ──

    @Test
    fun `rejects breakpoint-paused missing pauseId`() {
        val raw = json("""{"kind":"breakpoint.paused","phase":"request","device":"x","request":{"url":"u","method":"GET","headers":{}}}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused empty pauseId`() {
        val raw = json("""{"kind":"breakpoint.paused","pauseId":"","phase":"request","device":"x","request":{"url":"u","method":"GET","headers":{}}}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused oversized pauseId`() {
        val hugeId = "a".repeat(257)
        val raw = json(
            """{"kind":"breakpoint.paused","pauseId":"$hugeId","phase":"request","device":"x",""" +
                """"request":{"url":"u","method":"GET","headers":{}}}"""
        )
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused unknown phase`() {
        val raw = json("""{"kind":"breakpoint.paused","pauseId":"p1","phase":"sideways","device":"x","request":{"url":"u","method":"GET","headers":{}}}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused phase both`() {
        // "both" is valid for a breakpoint RULE's phase but not for a live pause.
        val raw = json("""{"kind":"breakpoint.paused","pauseId":"p1","phase":"both","device":"x","request":{"url":"u","method":"GET","headers":{}}}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused missing device`() {
        val raw = json("""{"kind":"breakpoint.paused","pauseId":"p1","phase":"request","request":{"url":"u","method":"GET","headers":{}}}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused wrong type device`() {
        val raw = json("""{"kind":"breakpoint.paused","pauseId":"p1","phase":"request","device":42,"request":{"url":"u","method":"GET","headers":{}}}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused missing request`() {
        val raw = json("""{"kind":"breakpoint.paused","pauseId":"p1","phase":"request","device":"x"}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-paused response missing body`() {
        val raw = json(
            """{"kind":"breakpoint.paused","pauseId":"p1","phase":"response","device":"x",""" +
                """"request":{"url":"u","method":"GET","headers":{}},"response":{"status":200,"headers":{}}}"""
        )
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-resume missing pauseId`() {
        assertNull(parseControlCommand(json("""{"kind":"breakpoint.resume"}""")))
    }

    @Test
    fun `rejects breakpoint-resume empty pauseId`() {
        assertNull(parseControlCommand(json("""{"kind":"breakpoint.resume","pauseId":""}""")))
    }

    @Test
    fun `rejects breakpoint-resume oversized pauseId`() {
        val hugeId = "a".repeat(257)
        assertNull(parseControlCommand(json("""{"kind":"breakpoint.resume","pauseId":"$hugeId"}""")))
    }

    @Test
    fun `rejects breakpoint-resume requestEdits with wrong type headers`() {
        val raw = json("""{"kind":"breakpoint.resume","pauseId":"p1","requestEdits":{"headers":"nope"}}""")
        assertNull(parseControlCommand(raw))
    }

    @Test
    fun `rejects breakpoint-abort missing pauseId`() {
        assertNull(parseControlCommand(json("""{"kind":"breakpoint.abort"}""")))
    }

    @Test
    fun `rejects breakpoint-abort non-string pauseId`() {
        assertNull(parseControlCommand(json("""{"kind":"breakpoint.abort","pauseId":42}""")))
    }

    // ── apply: resume merges edits over the original snapshot ───────────────

    @Test
    fun `breakpoint-resume with requestEdits merges over the original snapshot`() {
        BreakpointEngine.shared.enabled = true
        var action: ResumeRequestAction? = null
        val started = CountDownLatch(1)
        val done = CountDownLatch(1)
        val original = PausedRequest(url = "https://api.example.com/x", method = "GET", headers = mapOf("a" to "1"), body = null)

        val thread = Thread {
            started.countDown()
            action = BreakpointEngine.shared.pauseRequest("req-1", original)
            done.countDown()
        }
        thread.start()
        assertTrue(started.await(2, TimeUnit.SECONDS))
        var pauseId: String? = null
        while (pauseId == null) {
            pauseId = BreakpointEngine.shared.getPaused().firstOrNull()?.id
        }

        val cmd = ControlCommand.BreakpointResume(pauseId = pauseId, requestEdits = RequestEditsWire(method = "POST"), responseEdits = null)
        val result = applyControlCommand(cmd)
        assertEquals(ControlApplyResult.Success, result)

        assertTrue(done.await(2, TimeUnit.SECONDS))
        val resume = action as ResumeRequestAction.Resume
        assertEquals("POST", resume.edits?.method)
        assertEquals(original.url, resume.edits?.url)
        assertEquals(original.headers, resume.edits?.headers)
    }

    @Test
    fun `breakpoint-resume with responseEdits merges over the original snapshot`() {
        BreakpointEngine.shared.enabled = true
        var action: ResumeResponseAction? = null
        val started = CountDownLatch(1)
        val done = CountDownLatch(1)
        val original = PausedResponse(status = 200, headers = mapOf("a" to "1"), body = "original-body")

        val thread = Thread {
            started.countDown()
            action = BreakpointEngine.shared.pauseResponse("req-2", original)
            done.countDown()
        }
        thread.start()
        assertTrue(started.await(2, TimeUnit.SECONDS))
        var pauseId: String? = null
        while (pauseId == null) {
            pauseId = BreakpointEngine.shared.getPaused().firstOrNull()?.id
        }

        val cmd = ControlCommand.BreakpointResume(pauseId = pauseId, requestEdits = null, responseEdits = ResponseEditsWire(status = 500))
        val result = applyControlCommand(cmd)
        assertEquals(ControlApplyResult.Success, result)

        assertTrue(done.await(2, TimeUnit.SECONDS))
        val resume = action as ResumeResponseAction.Resume
        assertEquals(500, resume.edits?.status)
        assertEquals(original.body, resume.edits?.body)
    }

    @Test
    fun `breakpoint-resume for unknown pauseId is still Success (idempotent)`() {
        val result = applyControlCommand(ControlCommand.BreakpointResume(pauseId = "never-existed", requestEdits = null, responseEdits = null))
        assertEquals(ControlApplyResult.Success, result)
    }

    @Test
    fun `breakpoint-abort resolves the pause with an abort action`() {
        BreakpointEngine.shared.enabled = true
        var action: ResumeRequestAction? = null
        val started = CountDownLatch(1)
        val done = CountDownLatch(1)
        val original = PausedRequest(url = "https://api.example.com/y", method = "GET", headers = emptyMap(), body = null)

        val thread = Thread {
            started.countDown()
            action = BreakpointEngine.shared.pauseRequest("req-3", original)
            done.countDown()
        }
        thread.start()
        assertTrue(started.await(2, TimeUnit.SECONDS))
        var pauseId: String? = null
        while (pauseId == null) {
            pauseId = BreakpointEngine.shared.getPaused().firstOrNull()?.id
        }

        val result = applyControlCommand(ControlCommand.BreakpointAbort(pauseId))
        assertEquals(ControlApplyResult.Success, result)
        assertTrue(done.await(2, TimeUnit.SECONDS))
        assertEquals(ResumeRequestAction.Abort, action)
    }

    @Test
    fun `breakpoint-paused is refused - a device must never apply its own pause notification`() {
        val cmd = ControlCommand.BreakpointPaused(
            pauseId = "pause_1",
            ruleId = null,
            phase = "request",
            device = "android-emulator",
            request = PausedRequestSnapshot(url = "https://api.example.com/x", method = "GET", headers = emptyMap(), body = null),
            response = null,
        )
        val result = applyControlCommand(cmd) as ControlApplyResult.Failure
        assertTrue(result.error.contains("device to host only"))
    }

    // ── direction guard ───────────────────────────────────────────────────

    @Test
    fun `isDeviceToHostCommand is true only for breakpoint-paused`() {
        val paused = ControlCommand.BreakpointPaused(
            pauseId = "p1",
            ruleId = null,
            phase = "request",
            device = "x",
            request = PausedRequestSnapshot(url = "u", method = "GET", headers = emptyMap(), body = null),
            response = null,
        )
        assertTrue(isDeviceToHostCommand(paused))

        val hostToDevice = listOf(
            ControlCommand.MockClear,
            ControlCommand.BreakpointResume(pauseId = "p1", requestEdits = null, responseEdits = null),
            ControlCommand.BreakpointAbort(pauseId = "p1"),
            ControlCommand.ThrottleSet(profile = "none"),
        )
        for (cmd in hostToDevice) {
            assertFalse(isDeviceToHostCommand(cmd))
        }
    }
}
