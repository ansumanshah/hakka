package com.noodleapps.hakka

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * Regression coverage for two bugs only reachable through a real breakpoint pause/resume
 * round-trip on [HakkaInterceptor.intercept] — neither [HakkaInterceptorTest] nor
 * [ControlCommandBreakpointPauseTest] drives [BreakpointEngine] through a live interceptor
 * call, so both were previously untested at this layer.
 */
class HakkaInterceptorBreakpointResumeTest {
    private lateinit var server: MockWebServer

    @BeforeEach
    fun setup() {
        MockEngine.shared.clearRules()
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun teardown() {
        MockEngine.shared.clearRules()
        BreakpointEngine.shared.clearBreakpoints()
        BreakpointEngine.shared.enabled = false
        server.shutdown()
    }

    /** Busy-polls for the next pause to appear — mirrors ControlCommandBreakpointPauseTest's pattern. */
    private fun awaitPauseId(): String {
        var pauseId: String? = null
        val deadline = System.currentTimeMillis() + 5_000
        while (pauseId == null && System.currentTimeMillis() < deadline) {
            pauseId = BreakpointEngine.shared.getPaused().firstOrNull()?.id
        }
        return pauseId ?: throw AssertionError("no breakpoint pause appeared within 5s")
    }

    @Test
    fun `aborting a request-phase breakpoint does not leak the inFlight entry`() {
        BreakpointEngine.shared.enabled = true
        BreakpointEngine.shared.addBreakpoint(
            BreakpointRuleInput(pattern = "/pausable", on = BreakpointPhase.REQUEST)
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        val call = client.newCall(Request.Builder().url(server.url("/pausable")).build())

        val callThread = Thread {
            try {
                call.execute().close()
            } catch (_: Exception) {
                // Expected: the abort surfaces as AbortedException.
            }
        }
        callThread.start()

        val pauseId = awaitPauseId()
        BreakpointEngine.shared.abort(pauseId)
        callThread.join(5_000)

        // Before the fix, the AbortedException thrown at the request-phase abort path skips
        // captureProcessor.enqueue() entirely, so inFlight[id] — the only other place it's
        // removed is CaptureProcessor's onProcessed callback — is never cleaned up.
        assertEquals(0, interceptor.inFlightRequests().size, "aborted request leaked its inFlight entry")
    }

    @Test
    fun `resuming a response-phase breakpoint with only a status edit preserves the real body`() {
        val binaryBody = byteArrayOf(1, 2, 3, 4, 5)
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(Buffer().write(binaryBody))
                .setHeader("Content-Type", "application/octet-stream")
        )
        BreakpointEngine.shared.enabled = true
        BreakpointEngine.shared.addBreakpoint(
            BreakpointRuleInput(pattern = "/pausable-response", on = BreakpointPhase.RESPONSE)
        )
        val interceptor = HakkaInterceptor()
        val client = OkHttpClient.Builder().addInterceptor(interceptor).build()
        val call = client.newCall(Request.Builder().url(server.url("/pausable-response")).build())

        var response: Response? = null
        val callThread = Thread { response = call.execute() }
        callThread.start()

        val pauseId = awaitPauseId()
        // Only the status is edited — edits.body stays null, meaning "keep original value"
        // per PausedResponseEdits's doc.
        BreakpointEngine.shared.resumeResponse(pauseId, PausedResponseEdits(status = 201))
        callThread.join(5_000)

        val resp = response ?: throw AssertionError("call thread did not complete")
        assertEquals(201, resp.code)
        // Before the fix, the non-text (binary) body has no captured text preview, so
        // `edits.body ?: respBodyText ?: ""` unconditionally rebuilds the body as "" —
        // destroying the real binary body even though only the status was edited.
        assertArrayEquals(binaryBody, resp.body!!.bytes())
        resp.close()
    }
}
