package com.noodleapps.hakka

import org.json.JSONException
import org.json.JSONObject

/**
 * control.ts mirror — shared control-command contract for driving the mock, breakpoint,
 * and throttle engines from an external peer (e.g. the MCP server, relayed over the bridge).
 *
 * Canonical source: `packages/hakka-core/src/engine/control.ts`. This file MUST stay in lockstep
 * with it — same `kind` strings, same field names, same validation rules.
 *
 * [parseControlCommand] validates an untyped JSON payload from the wire into a
 * [ControlCommand] — strict shape checking, never throws, returns `null` on anything
 * malformed.
 *
 * [applyControlCommand] drives the singleton engines ([MockEngine.shared],
 * [BreakpointEngine.shared], [ThrottleEngine.shared]). It is fail-open: any engine-call
 * exception is caught and reported as [ControlApplyResult.Failure] — a malformed or
 * unexpected command must never throw into the host app.
 *
 * Id semantics: ids for `mock.add` / `breakpoint.add` are minted by the REMOTE caller (not
 * generated locally) so that peer can later remove the same rule cross-process.
 * [MockEngine.addRule] / [BreakpointEngine.addBreakpoint] honor a caller-supplied id when
 * present. Adding with an id that already exists REPLACES that rule in place
 * (replace-by-id) rather than rejecting or creating a duplicate.
 */

/** External ids: minted by the remote caller, validated before use locally. */
private val EXTERNAL_ID_RE = Regex("^[A-Za-z0-9_-]{1,64}$")

private val THROTTLE_PROFILES = setOf("none", "fast-3g", "slow-3g", "offline", "edge", "custom")
private val BREAKPOINT_PHASES = setOf("request", "response", "both")
private val MOCK_MODES = setOf("mock", "rewrite")

/** Sealed control-command union — mirrors `ControlCommand` in control.ts. */
sealed class ControlCommand {
    data class MockAdd(val rule: ParsedMockRule) : ControlCommand()
    data class MockRemove(val id: String) : ControlCommand()
    object MockClear : ControlCommand()
    data class BreakpointAdd(val breakpoint: ParsedBreakpoint) : ControlCommand()
    data class BreakpointRemove(val id: String) : ControlCommand()
    data class ThrottleSet(
        val profile: String,
        val latencyMs: Long? = null,
        val downloadKbps: Long? = null,
    ) : ControlCommand()
}

/** Validated `mock.add` rule payload — wire shape, prior to mapping onto [MockRuleInput]. */
data class ParsedMockRule(
    val id: String,
    val pattern: String,
    val method: String?,
    val mode: String?,
    val status: Int,
    val headers: Map<String, String>,
    val body: String,
    val delayMs: Long,
    val enabled: Boolean,
    val redirectTo: String?,
    val block: Boolean,
    val modify: MockRuleModify?,
)

/** Validated `breakpoint.add` payload — wire shape, prior to mapping onto [BreakpointRuleInput]. */
data class ParsedBreakpoint(
    val id: String,
    val pattern: String,
    val method: String?,
    val on: String?,
    val enabled: Boolean,
)

private fun isExternalId(v: String?): Boolean = v != null && EXTERNAL_ID_RE.matches(v)

/** True when [obj] has [key] present and its value is not JSON null. */
private fun JSONObject.hasNonNull(key: String): Boolean = has(key) && !isNull(key)

/**
 * Strict string accessor: returns the value only when it is present, non-null, and
 * actually a JSON string — unlike [JSONObject.optString], this does NOT coerce numbers,
 * booleans, or other types to their string form (control.ts uses `typeof x === 'string'`).
 */
private fun JSONObject.optStringOrNull(key: String): String? =
    if (hasNonNull(key)) opt(key) as? String else null

/** Validated wire-shape mock response — see [parseMockResponse]. */
private data class ParsedMockResponse(
    val status: Int,
    val headers: Map<String, String>,
    val body: String,
    val delayMs: Long,
)

/**
 * Validates the subset of `MockResponse` accepted over the wire (no functions — those
 * cannot cross the bridge). Returns null on any malformed shape.
 */
private fun parseMockResponse(v: JSONObject?): ParsedMockResponse? {
    if (v == null) return null
    if (!v.hasNonNull("status")) return null
    val status = v.opt("status")
    if (status !is Int && status !is Long && status !is Double) return null
    val statusInt = when (status) {
        is Int -> status
        is Long -> status.toInt()
        is Double -> {
            if (!status.isFinite()) return null
            status.toInt()
        }
        else -> return null
    }

    val headers: Map<String, String> = if (v.hasNonNull("headers")) {
        val h = v.opt("headers") as? JSONObject ?: return null
        val map = LinkedHashMap<String, String>()
        for (key in h.keys()) {
            val value = h.opt(key)
            if (value !is String) return null
            map[key] = value
        }
        map
    } else {
        emptyMap()
    }

    // body is required by control.ts (string | object) — absent body is invalid.
    if (!v.hasNonNull("body")) return null
    val body: String = when (val bodyRaw = v.opt("body")) {
        is String -> bodyRaw
        is JSONObject -> bodyRaw.toString()
        is org.json.JSONArray -> bodyRaw.toString()
        else -> return null
    }

    var delayMs = 0L
    if (v.hasNonNull("delay")) {
        val delay = v.opt("delay")
        val delayNum = when (delay) {
            is Int -> delay.toLong()
            is Long -> delay
            is Double -> if (delay.isFinite()) delay.toLong() else return null
            else -> return null
        }
        if (delayNum < 0) return null
        delayMs = delayNum
    }

    return ParsedMockResponse(statusInt, headers, body, delayMs)
}

/**
 * Validates the [MockRuleModify] shape (see `MockEngine.kt`) — plain data only, no
 * functions. Matches [parseMockRuleInput]'s style: any malformed sub-field rejects the
 * whole `modify` block (and, via the caller, the whole `mock.add` command) rather than
 * silently dropping just that field. Mirrors `control.ts`'s `parseMockRuleModify` exactly.
 */
private fun parseMockRuleModify(v: JSONObject?): MockRuleModify? {
    if (v == null) return null

    fun stringMap(key: String): Map<String, String>? {
        if (!v.hasNonNull(key)) return null
        val obj = v.opt(key) as? JSONObject ?: return MALFORMED_MAP
        val map = LinkedHashMap<String, String>()
        for (k in obj.keys()) {
            val value = obj.opt(k) as? String ?: return MALFORMED_MAP
            map[k] = value
        }
        return map
    }

    fun stringList(key: String): List<String>? {
        if (!v.hasNonNull(key)) return null
        val arr = v.opt(key) as? org.json.JSONArray ?: return MALFORMED_LIST
        val out = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            out.add(arr.opt(i) as? String ?: return MALFORMED_LIST)
        }
        return out
    }

    val setRequestHeaders = stringMap("setRequestHeaders")
    if (setRequestHeaders === MALFORMED_MAP) return null
    val removeRequestHeaders = stringList("removeRequestHeaders")
    if (removeRequestHeaders === MALFORMED_LIST) return null
    val setQueryParams = stringMap("setQueryParams")
    if (setQueryParams === MALFORMED_MAP) return null
    val removeQueryParams = stringList("removeQueryParams")
    if (removeQueryParams === MALFORMED_LIST) return null
    val setResponseHeaders = stringMap("setResponseHeaders")
    if (setResponseHeaders === MALFORMED_MAP) return null
    val removeResponseHeaders = stringList("removeResponseHeaders")
    if (removeResponseHeaders === MALFORMED_LIST) return null

    var status: Int? = null
    if (v.hasNonNull("status")) {
        val raw = v.opt("status")
        status = when (raw) {
            is Int -> raw
            is Long -> raw.toInt()
            is Double -> if (raw.isFinite()) raw.toInt() else return null
            else -> return null
        }
    }

    var replaceBody: List<MockRuleModify.BodyReplacement>? = null
    if (v.hasNonNull("replaceBody")) {
        val arr = v.opt("replaceBody") as? org.json.JSONArray ?: return null
        val out = mutableListOf<MockRuleModify.BodyReplacement>()
        for (i in 0 until arr.length()) {
            val entry = arr.opt(i) as? JSONObject ?: return null
            val find = entry.opt("find") as? String ?: return null
            val replace = entry.opt("replace") as? String ?: return null
            out.add(MockRuleModify.BodyReplacement(find, replace))
        }
        replaceBody = out
    }

    return MockRuleModify(
        setRequestHeaders = setRequestHeaders,
        removeRequestHeaders = removeRequestHeaders,
        setQueryParams = setQueryParams,
        removeQueryParams = removeQueryParams,
        status = status,
        setResponseHeaders = setResponseHeaders,
        removeResponseHeaders = removeResponseHeaders,
        replaceBody = replaceBody,
    )
}

/** Sentinel returned by the local `stringMap`/`stringList` helpers inside [parseMockRuleModify]
 *  to distinguish "malformed" from "absent" (`null`) without a nested-Optional dance in Kotlin. */
private val MALFORMED_MAP: Map<String, String> = emptyMap()
private val MALFORMED_LIST: List<String> = emptyList()

private fun parseMockRuleInput(v: JSONObject?): ParsedMockRule? {
    if (v == null) return null

    val id = v.optStringOrNull("id")
    if (!isExternalId(id)) return null

    val pattern = v.optStringOrNull("pattern")
    if (pattern.isNullOrEmpty()) return null

    val method = v.optStringOrNull("method")
    if (v.hasNonNull("method") && method == null) return null

    val mode = v.optStringOrNull("mode")
    if (v.hasNonNull("mode") && (mode == null || mode !in MOCK_MODES)) return null

    if (!v.hasNonNull("enabled")) return null
    val enabledVal = v.opt("enabled")
    if (enabledVal !is Boolean) return null

    val responseObj = if (v.hasNonNull("response")) v.opt("response") as? JSONObject else null
    val parsedResponse = parseMockResponse(responseObj) ?: return null

    var redirectTo: String? = null
    if (v.hasNonNull("redirectTo")) {
        redirectTo = v.opt("redirectTo") as? String ?: return null
    }

    var block = false
    if (v.hasNonNull("block")) {
        block = v.opt("block") as? Boolean ?: return null
    }

    var modify: MockRuleModify? = null
    if (v.hasNonNull("modify")) {
        val modifyObj = v.opt("modify") as? JSONObject ?: return null
        modify = parseMockRuleModify(modifyObj) ?: return null
    }

    return ParsedMockRule(
        id = requireNotNull(id),
        pattern = pattern,
        method = method,
        mode = mode,
        status = parsedResponse.status,
        headers = parsedResponse.headers,
        body = parsedResponse.body,
        delayMs = parsedResponse.delayMs,
        enabled = enabledVal,
        redirectTo = redirectTo,
        block = block,
        modify = modify,
    )
}

private fun parseBreakpointInput(v: JSONObject?): ParsedBreakpoint? {
    if (v == null) return null

    val id = v.optStringOrNull("id")
    if (!isExternalId(id)) return null

    val pattern = v.optStringOrNull("pattern")
    if (pattern.isNullOrEmpty()) return null

    val method = v.optStringOrNull("method")
    if (v.hasNonNull("method") && method == null) return null

    val on = v.optStringOrNull("on")
    if (v.hasNonNull("on") && (on == null || on !in BREAKPOINT_PHASES)) return null

    if (!v.hasNonNull("enabled")) return null
    val enabledVal = v.opt("enabled")
    if (enabledVal !is Boolean) return null

    return ParsedBreakpoint(
        id = requireNotNull(id),
        pattern = pattern,
        method = method,
        on = on,
        enabled = enabledVal,
    )
}

/**
 * Validate an untyped JSON payload into a [ControlCommand]. Strict shape checking —
 * returns `null` on anything malformed. Never throws.
 */
fun parseControlCommand(raw: JSONObject?): ControlCommand? {
    return try {
        if (raw == null) return null
        val kind = raw.optStringOrNull("kind") ?: return null

        when (kind) {
            "mock.add" -> {
                val ruleObj = if (raw.hasNonNull("rule")) raw.opt("rule") as? JSONObject else null
                val rule = parseMockRuleInput(ruleObj) ?: return null
                ControlCommand.MockAdd(rule)
            }
            "mock.remove" -> {
                val id = raw.optStringOrNull("id")
                if (!isExternalId(id)) return null
                ControlCommand.MockRemove(requireNotNull(id))
            }
            "mock.clear" -> ControlCommand.MockClear
            "breakpoint.add" -> {
                val bpObj = if (raw.hasNonNull("breakpoint")) raw.opt("breakpoint") as? JSONObject else null
                val breakpoint = parseBreakpointInput(bpObj) ?: return null
                ControlCommand.BreakpointAdd(breakpoint)
            }
            "breakpoint.remove" -> {
                val id = raw.optStringOrNull("id")
                if (!isExternalId(id)) return null
                ControlCommand.BreakpointRemove(requireNotNull(id))
            }
            "throttle.set" -> {
                val profile = raw.optStringOrNull("profile")
                if (profile == null || profile !in THROTTLE_PROFILES) return null

                var latencyMs: Long? = null
                if (raw.hasNonNull("latencyMs")) {
                    val v = raw.opt("latencyMs")
                    val num = when (v) {
                        is Int -> v.toLong()
                        is Long -> v
                        is Double -> if (v.isFinite()) v.toLong() else return null
                        else -> return null
                    }
                    if (num < 0) return null
                    latencyMs = num
                }

                var downloadKbps: Long? = null
                if (raw.hasNonNull("downloadKbps")) {
                    val v = raw.opt("downloadKbps")
                    val num = when (v) {
                        is Int -> v.toLong()
                        is Long -> v
                        is Double -> if (v.isFinite()) v.toLong() else return null
                        else -> return null
                    }
                    if (num < 0) return null
                    downloadKbps = num
                }

                ControlCommand.ThrottleSet(profile, latencyMs, downloadKbps)
            }
            else -> null
        }
    } catch (_: JSONException) {
        null
    } catch (_: Exception) {
        // Fail-open: malformed input must never throw.
        null
    }
}

/** Result of [applyControlCommand] — mirrors the `{ ok }` shape returned by control.ts. */
sealed class ControlApplyResult {
    object Success : ControlApplyResult()
    data class Failure(val error: String) : ControlApplyResult()
}

/**
 * Apply a validated [ControlCommand] to the singleton engines ([MockEngine.shared],
 * [BreakpointEngine.shared], [ThrottleEngine.shared]). Every engine call is wrapped in
 * try/catch — a throw from the engine is reported as [ControlApplyResult.Failure], never
 * propagated. This is a hard invariant: a malformed control frame must never throw into
 * the host app.
 */
fun applyControlCommand(cmd: ControlCommand): ControlApplyResult {
    return try {
        when (cmd) {
            is ControlCommand.MockAdd -> {
                val rule = cmd.rule
                MockEngine.shared.addRule(
                    MockRuleInput(
                        pattern = rule.pattern,
                        isRegex = false,
                        method = rule.method,
                        response = MockResponse(
                            status = rule.status,
                            headers = rule.headers,
                            body = rule.body,
                            delayMs = rule.delayMs,
                        ),
                        enabled = rule.enabled,
                        id = rule.id,
                        redirectTo = rule.redirectTo,
                        block = rule.block,
                        modify = rule.modify,
                    )
                )
                ControlApplyResult.Success
            }
            is ControlCommand.MockRemove -> {
                MockEngine.shared.removeRule(cmd.id)
                ControlApplyResult.Success
            }
            ControlCommand.MockClear -> {
                MockEngine.shared.clearRules()
                ControlApplyResult.Success
            }
            is ControlCommand.BreakpointAdd -> {
                val bp = cmd.breakpoint
                BreakpointEngine.shared.addBreakpoint(
                    BreakpointRuleInput(
                        pattern = bp.pattern,
                        method = bp.method,
                        on = when (bp.on) {
                            "response" -> BreakpointPhase.RESPONSE
                            "both" -> BreakpointPhase.BOTH
                            else -> BreakpointPhase.REQUEST
                        },
                        enabled = bp.enabled,
                        id = bp.id,
                    )
                )
                ControlApplyResult.Success
            }
            is ControlCommand.BreakpointRemove -> {
                BreakpointEngine.shared.removeBreakpoint(cmd.id)
                ControlApplyResult.Success
            }
            is ControlCommand.ThrottleSet -> {
                if (cmd.profile == "custom") {
                    ThrottleEngine.shared.setCustom(cmd.latencyMs ?: 0L, cmd.downloadKbps ?: 0L)
                } else {
                    ThrottleEngine.shared.setProfile(
                        when (cmd.profile) {
                            "fast-3g" -> ThrottleProfile.FAST_3G
                            "slow-3g" -> ThrottleProfile.SLOW_3G
                            "edge" -> ThrottleProfile.EDGE
                            "offline" -> ThrottleProfile.OFFLINE
                            else -> ThrottleProfile.NONE
                        }
                    )
                }
                ControlApplyResult.Success
            }
        }
    } catch (e: Exception) {
        ControlApplyResult.Failure(e.message ?: e.toString())
    }
}
