package com.noodleapps.hakka

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RuntimeControlTest {
    @Test
    fun `parses every pinned runtime-control fixture`() {
        listOf("hello", "welcome", "targets", "request", "applied", "failed").forEach { name ->
            assertNotNull(parseRuntimeControlMessage(ControlFixtures.readRuntimeControlJSON("$name.json")))
        }
    }

    @Test
    fun `hello advertises only Android engine capabilities`() {
        val hello = JSONObject(buildRuntimeHelloFrame()).getJSONObject("payload")
        assertEquals("runtime", hello.getString("role"))
        assertEquals("android", hello.getString("runtime"))
        assertEquals(1, hello.getInt("protocolVersion"))
        val capabilities = (0 until hello.getJSONArray("capabilities").length())
            .map { hello.getJSONArray("capabilities").getString(it) }
        assertTrue("mock.add" in capabilities)
        assertTrue("throttle.set" in capabilities)
        assertFalse("request.replay" in capabilities)
        assertFalse("storage.set" in capabilities)
    }

    @Test
    fun `applies exact-target request before acknowledging it`() {
        MockEngine.shared.addRule(MockRuleInput(pattern = "/old", response = MockResponse(status = 200)))
        val handler = RuntimeControlHandler()
        handler.handle(ControlFixtures.readRuntimeControlJSON("welcome.json").toString())

        val result = handler.handle(ControlFixtures.readRuntimeControlJSON("request.json").toString())

        assertTrue(MockEngine.shared.getRules().isEmpty())
        assertEquals("applied", result.resultPayload()?.status)
    }

    @Test
    fun `rejects unsupported capabilities without applying and suppresses duplicates`() {
        var applies = 0
        val handler = RuntimeControlHandler(capabilities = emptySet()) {
            applies++
            ControlApplyResult.Success
        }
        handler.handle(ControlFixtures.readRuntimeControlJSON("welcome.json").toString())

        val unsupported = handler.handle(ControlFixtures.readRuntimeControlJSON("request.json").toString())
        assertEquals(RuntimeControlError.UNSUPPORTED_CAPABILITY, unsupported.resultPayload()?.error)
        assertEquals(0, applies)

        val duplicateHandler = RuntimeControlHandler {
            applies++
            ControlApplyResult.Success
        }
        duplicateHandler.handle(ControlFixtures.readRuntimeControlJSON("welcome.json").toString())
        val first = duplicateHandler.handle(ControlFixtures.readRuntimeControlJSON("request.json").toString())
        val second = duplicateHandler.handle(ControlFixtures.readRuntimeControlJSON("request.json").toString())
        assertEquals(1, applies)
        assertEquals(first.resultPayload(), second.resultPayload())
    }

    @Test
    fun `wrong target and raw engine failures never acknowledge sensitive details`() {
        var applies = 0
        val handler = RuntimeControlHandler {
            applies++
            ControlApplyResult.Failure("credential=secret")
        }
        handler.handle(ControlFixtures.readRuntimeControlJSON("welcome.json").toString())

        val wrongTarget = ControlFixtures.readRuntimeControlJSON("request.json").put(
            "payload",
            ControlFixtures.readRuntimeControlJSON("request.json").getJSONObject("payload").put("targetId", "target-b"),
        )
        assertEquals(RuntimeControlDispatch.Handled, handler.handle(wrongTarget.toString()))
        assertEquals(0, applies)

        val failed = handler.handle(ControlFixtures.readRuntimeControlJSON("request.json").toString())
        val frame = failed.resultFrame()
        assertEquals(RuntimeControlError.APPLY_FAILED, failed.resultPayload()?.error)
        assertFalse(frame.contains("credential"))
        assertFalse(frame.contains("secret"))
    }

    @Test
    fun `rejects malformed requests and false success results`() {
        assertNull(
            parseRuntimeControlMessage(
                """{"type":"control.request","payload":{"commandId":"x","targetId":"target-a","timeoutMs":0,"command":{"kind":"mock.clear"}}}""",
            ),
        )
        assertNull(
            parseRuntimeControlMessage(
                """{"type":"control.result","payload":{"commandId":"x","targetId":"target-a","status":"applied","error":"timeout"}}""",
            ),
        )
    }
}

private fun RuntimeControlDispatch.resultPayload(): RuntimeControlMessage.Result? =
    (this as? RuntimeControlDispatch.Result)?.value

private fun RuntimeControlDispatch.resultFrame(): String =
    resultPayload()?.let(::buildRuntimeControlResultFrame) ?: ""
