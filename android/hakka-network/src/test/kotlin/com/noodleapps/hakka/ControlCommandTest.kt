package com.noodleapps.hakka

import org.json.JSONObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Unit tests for the control-frame contract ([parseControlCommand] / [applyControlCommand] /
 * [handleInboundFrame]) — the Kotlin mirror of `packages/hakka-core/src/engine/control.ts`.
 *
 * Covers:
 * - Parse: valid shape per `kind`, malformed payloads, hostile/invalid external ids.
 * - Apply: engine state assertions on [MockEngine.shared] / [BreakpointEngine.shared] /
 *   [ThrottleEngine.shared], replace-by-id semantics for `mock.add` / `breakpoint.add`.
 * - Fail-open: [handleInboundFrame] never throws on hostile/malformed input.
 */
class ControlCommandTest {

    @AfterEach
    fun tearDown() {
        MockEngine.shared.clearRules()
        BreakpointEngine.shared.clearBreakpoints()
        BreakpointEngine.shared.enabled = false
        ThrottleEngine.shared.setProfile(ThrottleProfile.NONE)
    }

    private fun json(text: String): JSONObject = JSONObject(text)

    // ── parse: mock.add ─────────────────────────────────────────────────────

    @Test
    fun `parses a valid mock-add command`() {
        val cmd = parseControlCommand(
            json(
                """
                {
                  "kind": "mock.add",
                  "rule": {
                    "id": "mcp-mock-1",
                    "pattern": "/api/users",
                    "mode": "mock",
                    "response": { "status": 503, "body": "{\"down\":true}" },
                    "enabled": true
                  }
                }
                """.trimIndent()
            )
        )
        assertNotNull(cmd)
        val mockAdd = cmd as ControlCommand.MockAdd
        assertEquals("mcp-mock-1", mockAdd.rule.id)
        assertEquals("/api/users", mockAdd.rule.pattern)
        assertEquals(503, mockAdd.rule.status)
        assertEquals("{\"down\":true}", mockAdd.rule.body)
        assertTrue(mockAdd.rule.enabled)
    }

    // Regression: `headerValues` is the additive multi-value widening of `headers` (see
    // [MockResponse.headerValues]'s doc) — two Set-Cookie values survive parsing distinctly,
    // and `headers` still carries the representative first value for a decoder that only
    // reads it.
    @Test
    fun `mock-add parses headerValues alongside headers`() {
        val cmd = parseControlCommand(
            json(
                """
                {
                  "kind": "mock.add",
                  "rule": {
                    "id": "mcp-mock-cookies",
                    "pattern": "/login",
                    "response": {
                      "status": 200,
                      "headers": { "Set-Cookie": "session=abc" },
                      "headerValues": { "Set-Cookie": ["session=abc; Path=/", "consent=yes; Path=/"] },
                      "body": ""
                    },
                    "enabled": true
                  }
                }
                """.trimIndent()
            )
        )
        assertNotNull(cmd)
        val mockAdd = cmd as ControlCommand.MockAdd
        assertEquals("session=abc", mockAdd.rule.headers["Set-Cookie"])
        assertEquals(listOf("session=abc; Path=/", "consent=yes; Path=/"), mockAdd.rule.headerValues["Set-Cookie"])
    }

    @Test
    fun `mock-add without headerValues parses it as empty (old payload, unchanged)`() {
        val cmd = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"mcp-mock-old","pattern":"/x",
                    "response":{"status":200,"headers":{"x-a":"b"},"body":""},"enabled":true}}"""
            )
        )
        assertNotNull(cmd)
        val mockAdd = cmd as ControlCommand.MockAdd
        assertTrue(mockAdd.rule.headerValues.isEmpty())
    }

    @Test
    fun `mock-add rejects headerValues with a non-array value`() {
        assertNull(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"m","pattern":"/x",
                        "response":{"status":200,"headerValues":{"Set-Cookie":"not-an-array"},"body":""},"enabled":true}}"""
                )
            )
        )
    }

    @Test
    fun `mock-add accepts object body and serializes it`() {
        val cmd = parseControlCommand(
            json(
                """
                {
                  "kind": "mock.add",
                  "rule": {
                    "id": "obj-body",
                    "pattern": "/x",
                    "response": { "status": 200, "body": { "ok": true } },
                    "enabled": true
                  }
                }
                """.trimIndent()
            )
        )
        assertNotNull(cmd)
        val rule = (cmd as ControlCommand.MockAdd).rule
        assertTrue(rule.body.contains("\"ok\":true") || rule.body.contains("\"ok\": true"))
    }

    @Test
    fun `mock-add parses and applies redirectTo and block`() {
        val cmd = parseControlCommand(
            json(
                """
                {
                  "kind": "mock.add",
                  "rule": {
                    "id": "rewrite-1",
                    "pattern": "/api/rewrite",
                    "mode": "rewrite",
                    "redirectTo": "https://example.com/other",
                    "block": false,
                    "response": { "status": 200, "body": "{}" },
                    "enabled": true
                  }
                }
                """.trimIndent()
            )
        )
        assertNotNull(cmd)
        val rule = (cmd as ControlCommand.MockAdd).rule
        assertEquals("https://example.com/other", rule.redirectTo)
        assertFalse(rule.block)
    }

    @Test
    fun `mock-add parses block true`() {
        val cmd = parseControlCommand(
            json("""{"kind":"mock.add","rule":{"id":"blocked-1","pattern":"/api","block":true,"response":{"status":200,"body":"{}"},"enabled":true}}""")
        )
        val rule = (cmd as ControlCommand.MockAdd).rule
        assertTrue(rule.block)
    }

    @Test
    fun `mock-add parses full modify block`() {
        val cmd = parseControlCommand(
            json(
                """
                {
                  "kind": "mock.add",
                  "rule": {
                    "id": "modify-1",
                    "pattern": "/api/modify",
                    "modify": {
                      "setRequestHeaders": {"X-A": "1"},
                      "removeRequestHeaders": ["X-B"],
                      "setQueryParams": {"q": "1"},
                      "removeQueryParams": ["r"],
                      "status": 201,
                      "setResponseHeaders": {"X-C": "2"},
                      "removeResponseHeaders": ["X-D"],
                      "replaceBody": [{"find": "a", "replace": "b"}]
                    },
                    "response": { "status": 200, "body": "{}" },
                    "enabled": true
                  }
                }
                """.trimIndent()
            )
        )
        assertNotNull(cmd)
        val modify = (cmd as ControlCommand.MockAdd).rule.modify
        assertNotNull(modify)
        assertEquals("1", modify!!.setRequestHeaders?.get("X-A"))
        assertEquals(listOf("X-B"), modify.removeRequestHeaders)
        assertEquals("1", modify.setQueryParams?.get("q"))
        assertEquals(listOf("r"), modify.removeQueryParams)
        assertEquals(201, modify.status)
        assertEquals("2", modify.setResponseHeaders?.get("X-C"))
        assertEquals(listOf("X-D"), modify.removeResponseHeaders)
        assertEquals("a", modify.replaceBody?.first()?.find)
        assertEquals("b", modify.replaceBody?.first()?.replace)
    }

    @Test
    fun `mock-add with empty modify block parses to a non-null empty modify`() {
        val cmd = parseControlCommand(
            json("""{"kind":"mock.add","rule":{"id":"modify-empty","pattern":"/api","modify":{},"response":{"status":200,"body":"{}"},"enabled":true}}""")
        )
        val modify = (cmd as ControlCommand.MockAdd).rule.modify
        assertNotNull(modify)
    }

    @Test
    fun `mock-add rejects malformed modify setRequestHeaders`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"m","pattern":"/api","modify":{"setRequestHeaders":{"X-A":1}},"response":{"status":200,"body":"{}"},"enabled":true}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects malformed modify replaceBody missing replace`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"m2","pattern":"/api","modify":{"replaceBody":[{"find":"a"}]},"response":{"status":200,"body":"{}"},"enabled":true}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects non-object modify`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"m3","pattern":"/api","modify":"not-an-object","response":{"status":200,"body":"{}"},"enabled":true}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects non-string redirectTo`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"m4","pattern":"/api","redirectTo":123,"response":{"status":200,"body":"{}"},"enabled":true}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects non-boolean block`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"m5","pattern":"/api","block":"yes","response":{"status":200,"body":"{}"},"enabled":true}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects missing rule`() {
        assertNull(parseControlCommand(json("""{"kind":"mock.add"}""")))
    }

    @Test
    fun `mock-add rejects missing response`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"/x","enabled":true}}""")
            )
        )
    }

    @Test
    fun `mock-add rejects empty pattern`() {
        assertNull(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"a","pattern":"","response":{"status":200,"body":""},"enabled":true}}"""
                )
            )
        )
    }

    @Test
    fun `mock-add rejects invalid mode`() {
        assertNull(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"a","pattern":"/x","mode":"bogus","response":{"status":200,"body":""},"enabled":true}}"""
                )
            )
        )
    }

    @Test
    fun `mock-add rejects non-numeric status`() {
        assertNull(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"a","pattern":"/x","response":{"status":"200","body":""},"enabled":true}}"""
                )
            )
        )
    }

    @Test
    fun `mock-add rejects negative delay`() {
        assertNull(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"a","pattern":"/x","response":{"status":200,"body":"","delay":-1},"enabled":true}}"""
                )
            )
        )
    }

    @Test
    fun `mock-add rejects non-string header values`() {
        assertNull(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"a","pattern":"/x","response":{"status":200,"body":"","headers":{"x":1}},"enabled":true}}"""
                )
            )
        )
    }

    @Test
    fun `mock-add rejects missing enabled`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"mock.add","rule":{"id":"a","pattern":"/x","response":{"status":200,"body":""}}}""")
            )
        )
    }

    // ── parse: hostile / malformed ids ──────────────────────────────────────

    @Test
    fun `rejects hostile ids with path traversal characters`() {
        assertNull(
            parseControlCommand(json("""{"kind":"mock.remove","id":"../etc/passwd"}"""))
        )
        assertNull(
            parseControlCommand(json("""{"kind":"breakpoint.remove","id":"../../secret"}"""))
        )
    }

    @Test
    fun `rejects ids over 64 chars`() {
        val longId = "a".repeat(65)
        assertNull(parseControlCommand(json("""{"kind":"mock.remove","id":"$longId"}""")))
    }

    @Test
    fun `rejects empty id`() {
        assertNull(parseControlCommand(json("""{"kind":"mock.remove","id":""}""")))
    }

    @Test
    fun `rejects numeric id (type coercion guard)`() {
        // org.json's optString would coerce a number to a string — the strict accessor
        // must not allow that, mirroring control.ts's `typeof id === 'string'` check.
        assertNull(parseControlCommand(json("""{"kind":"mock.remove","id":123}""")))
    }

    @Test
    fun `accepts id with underscores and hyphens`() {
        assertNotNull(parseControlCommand(json("""{"kind":"mock.remove","id":"mcp-mock_1-ABC"}""")))
    }

    // ── parse: mock.remove / mock.clear ─────────────────────────────────────

    @Test
    fun `parses mock-remove`() {
        val cmd = parseControlCommand(json("""{"kind":"mock.remove","id":"abc"}"""))
        assertEquals(ControlCommand.MockRemove("abc"), cmd)
    }

    @Test
    fun `parses mock-clear`() {
        assertEquals(ControlCommand.MockClear, parseControlCommand(json("""{"kind":"mock.clear"}""")))
    }

    // ── parse: breakpoint.add / remove ──────────────────────────────────────

    @Test
    fun `parses a valid breakpoint-add command`() {
        val cmd = parseControlCommand(
            json(
                """{"kind":"breakpoint.add","breakpoint":{"id":"bp-1","pattern":"/api","on":"response","enabled":true}}"""
            )
        )
        assertNotNull(cmd)
        val bp = (cmd as ControlCommand.BreakpointAdd).breakpoint
        assertEquals("bp-1", bp.id)
        assertEquals("response", bp.on)
    }

    @Test
    fun `breakpoint-add rejects invalid phase`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"breakpoint.add","breakpoint":{"id":"bp-1","pattern":"/api","on":"never","enabled":true}}""")
            )
        )
    }

    @Test
    fun `breakpoint-add rejects hostile id`() {
        assertNull(
            parseControlCommand(
                json("""{"kind":"breakpoint.add","breakpoint":{"id":"../x","pattern":"/api","enabled":true}}""")
            )
        )
    }

    // ── parse: throttle.set ──────────────────────────────────────────────────

    @Test
    fun `parses throttle-set with a known profile`() {
        val cmd = parseControlCommand(json("""{"kind":"throttle.set","profile":"slow-3g"}"""))
        assertEquals(ControlCommand.ThrottleSet("slow-3g", null, null), cmd)
    }

    @Test
    fun `parses throttle-set custom with latency and bandwidth`() {
        val cmd = parseControlCommand(
            json("""{"kind":"throttle.set","profile":"custom","latencyMs":100,"downloadKbps":50}""")
        )
        assertEquals(ControlCommand.ThrottleSet("custom", 100L, 50L), cmd)
    }

    @Test
    fun `throttle-set rejects unknown profile`() {
        assertNull(parseControlCommand(json("""{"kind":"throttle.set","profile":"bogus"}""")))
    }

    @Test
    fun `throttle-set rejects negative latency`() {
        assertNull(
            parseControlCommand(json("""{"kind":"throttle.set","profile":"custom","latencyMs":-5}"""))
        )
    }

    @Test
    fun `throttle-set rejects negative downloadKbps`() {
        assertNull(
            parseControlCommand(json("""{"kind":"throttle.set","profile":"custom","downloadKbps":-5}"""))
        )
    }

    // ── parse: unknown kind / malformed shape ───────────────────────────────

    @Test
    fun `rejects unknown kind`() {
        assertNull(parseControlCommand(json("""{"kind":"nonsense"}""")))
    }

    @Test
    fun `rejects missing kind`() {
        assertNull(parseControlCommand(json("""{"id":"abc"}""")))
    }

    @Test
    fun `rejects non-string kind`() {
        assertNull(parseControlCommand(json("""{"kind":123}""")))
    }

    @Test
    fun `parseControlCommand returns null for null input`() {
        assertNull(parseControlCommand(null))
    }

    // ── apply: mock engine ───────────────────────────────────────────────────

    @Test
    fun `apply mock-add creates a rule visible on MockEngine`() {
        val cmd = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"mcp-mock-1","pattern":"/api/users","response":{"status":503,"body":"down"},"enabled":true}}"""
            )
        ) as ControlCommand.MockAdd

        val result = applyControlCommand(cmd)
        assertEquals(ControlApplyResult.Success, result)

        val rule = MockEngine.shared.getRules().find { it.id == "mcp-mock-1" }
        assertNotNull(rule)
        assertEquals(503, rule!!.response.status)
        assertEquals("down", rule.response.body)
    }

    @Test
    fun `apply mock-add with redirectTo and modify creates a fully rewritten rule on MockEngine`() {
        val cmd = parseControlCommand(
            json(
                """
                {
                  "kind": "mock.add",
                  "rule": {
                    "id": "rewrite-apply-1",
                    "pattern": "/api",
                    "redirectTo": "https://other.example.com/api",
                    "modify": {"status": 201, "setResponseHeaders": {"X-A": "1"}},
                    "response": { "status": 200, "body": "{}" },
                    "enabled": true
                  }
                }
                """.trimIndent()
            )
        ) as ControlCommand.MockAdd

        val result = applyControlCommand(cmd)
        assertEquals(ControlApplyResult.Success, result)

        val rule = MockEngine.shared.getRules().find { it.id == "rewrite-apply-1" }
        assertNotNull(rule)
        assertEquals("https://other.example.com/api", rule!!.redirectTo)
        assertEquals(201, rule.modify?.status)
        assertEquals("1", rule.modify?.setResponseHeaders?.get("X-A"))
        assertTrue(rule.isRewrite)
    }

    @Test
    fun `apply mock-add with duplicate id replaces the existing rule`() {
        val first = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"dup","pattern":"/a","response":{"status":200,"body":"first"},"enabled":true}}"""
            )
        ) as ControlCommand.MockAdd
        applyControlCommand(first)

        val second = parseControlCommand(
            json(
                """{"kind":"mock.add","rule":{"id":"dup","pattern":"/b","response":{"status":404,"body":"second"},"enabled":false}}"""
            )
        ) as ControlCommand.MockAdd
        applyControlCommand(second)

        val rules = MockEngine.shared.getRules().filter { it.id == "dup" }
        assertEquals(1, rules.size, "duplicate id must replace, not duplicate")
        assertEquals("/b", rules.first().pattern)
        assertEquals(404, rules.first().response.status)
        assertFalse(rules.first().enabled)
    }

    @Test
    fun `apply mock-remove removes the rule by id`() {
        applyControlCommand(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"mcp-mock-2","pattern":"/x","response":{"status":200,"body":""},"enabled":true}}"""
                )
            ) as ControlCommand.MockAdd
        )
        applyControlCommand(ControlCommand.MockRemove("mcp-mock-2"))
        assertNull(MockEngine.shared.getRules().find { it.id == "mcp-mock-2" })
    }

    @Test
    fun `apply mock-clear removes all rules`() {
        applyControlCommand(
            parseControlCommand(
                json(
                    """{"kind":"mock.add","rule":{"id":"m1","pattern":"/x","response":{"status":200,"body":""},"enabled":true}}"""
                )
            ) as ControlCommand.MockAdd
        )
        applyControlCommand(ControlCommand.MockClear)
        assertTrue(MockEngine.shared.getRules().isEmpty())
    }

    // ── apply: breakpoint engine ──────────────────────────────────────────────

    @Test
    fun `apply breakpoint-add creates a rule visible on BreakpointEngine`() {
        val cmd = parseControlCommand(
            json("""{"kind":"breakpoint.add","breakpoint":{"id":"bp-a","pattern":"/api","on":"both","enabled":true}}""")
        ) as ControlCommand.BreakpointAdd
        applyControlCommand(cmd)

        val bp = BreakpointEngine.shared.getBreakpoints().find { it.id == "bp-a" }
        assertNotNull(bp)
        assertEquals(BreakpointPhase.BOTH, bp!!.on)
    }

    @Test
    fun `apply breakpoint-add with duplicate id replaces the existing breakpoint`() {
        applyControlCommand(
            parseControlCommand(
                json("""{"kind":"breakpoint.add","breakpoint":{"id":"dup-bp","pattern":"/a","on":"request","enabled":true}}""")
            ) as ControlCommand.BreakpointAdd
        )
        applyControlCommand(
            parseControlCommand(
                json("""{"kind":"breakpoint.add","breakpoint":{"id":"dup-bp","pattern":"/b","on":"response","enabled":false}}""")
            ) as ControlCommand.BreakpointAdd
        )

        val matches = BreakpointEngine.shared.getBreakpoints().filter { it.id == "dup-bp" }
        assertEquals(1, matches.size, "duplicate id must replace, not duplicate")
        assertEquals("/b", matches.first().pattern)
        assertEquals(BreakpointPhase.RESPONSE, matches.first().on)
        assertFalse(matches.first().enabled)
    }

    @Test
    fun `apply breakpoint-remove removes the rule by id`() {
        applyControlCommand(
            parseControlCommand(
                json("""{"kind":"breakpoint.add","breakpoint":{"id":"bp-rm","pattern":"/x","enabled":true}}""")
            ) as ControlCommand.BreakpointAdd
        )
        applyControlCommand(ControlCommand.BreakpointRemove("bp-rm"))
        assertNull(BreakpointEngine.shared.getBreakpoints().find { it.id == "bp-rm" })
    }

    // ── apply: throttle engine ────────────────────────────────────────────────

    @Test
    fun `apply throttle-set applies a named profile`() {
        applyControlCommand(ControlCommand.ThrottleSet("slow-3g"))
        assertTrue(ThrottleEngine.shared.isActive)
        assertEquals(ThrottleProfile.SLOW_3G, ThrottleEngine.shared.config.profile)
    }

    @Test
    fun `apply throttle-set custom stores latency and bandwidth`() {
        applyControlCommand(ControlCommand.ThrottleSet("custom", latencyMs = 250L, downloadKbps = 64L))
        assertEquals(ThrottleProfile.CUSTOM, ThrottleEngine.shared.config.profile)
        assertEquals(250L, ThrottleEngine.shared.config.latencyMs)
        assertEquals(64L, ThrottleEngine.shared.config.downloadKbps)
    }

    @Test
    fun `apply throttle-set none resets to pass-through`() {
        applyControlCommand(ControlCommand.ThrottleSet("slow-3g"))
        applyControlCommand(ControlCommand.ThrottleSet("none"))
        assertFalse(ThrottleEngine.shared.isActive)
    }

    // ── handleInboundFrame: end-to-end fail-open ─────────────────────────────

    @Test
    fun `handleInboundFrame applies a valid control envelope`() {
        handleInboundFrame(
            """{"type":"control","payload":{"kind":"throttle.set","profile":"fast-3g"}}"""
        )
        assertEquals(ThrottleProfile.FAST_3G, ThrottleEngine.shared.config.profile)
    }

    @Test
    fun `handleInboundFrame ignores non-control frame types`() {
        handleInboundFrame("""{"type":"request","payload":{"kind":"throttle.set","profile":"fast-3g"}}""")
        assertEquals(ThrottleProfile.NONE, ThrottleEngine.shared.config.profile)
    }

    @Test
    fun `handleInboundFrame never throws on hostile or malformed input`() {
        val hostileFrames = listOf(
            "not json{{",
            "",
            "null",
            "42",
            "[]",
            """{"type":"control"}""",
            """{"type":"control","payload":null}""",
            """{"type":"control","payload":"not-an-object"}""",
            """{"type":"control","payload":{"kind":"mock.add"}}""",
            """{"type":"control","payload":{"kind":"mock.remove","id":"../etc/passwd"}}""",
            """{"type":"control","payload":{"kind":"nonsense"}}""",
            """{"type":"control","payload":{"kind":123}}""",
            """{"type":123,"payload":{}}""",
        )
        for (frame in hostileFrames) {
            handleInboundFrame(frame)
        }
        // No rules/breakpoints should have leaked in from any hostile frame.
        assertTrue(MockEngine.shared.getRules().isEmpty())
        assertTrue(BreakpointEngine.shared.getBreakpoints().isEmpty())
    }
}
