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
/** A live pause is always at one concrete phase — never "both" (that's a rule-matching concept, not a paused-entry one). */
private val PAUSE_PHASES = setOf("request", "response")
private val MOCK_MODES = setOf("mock", "rewrite")

/** Pause ids are minted by the pausing device, not charset-restricted like external ids — just bounded so a hostile peer can't wedge a huge string into engine state. */
private const val MAX_PAUSE_ID_LEN = 256
private const val MAX_DEVICE_LEN = 256

private fun isPauseId(v: String?): Boolean = v != null && v.isNotEmpty() && v.length <= MAX_PAUSE_ID_LEN

/** Sealed control-command union — mirrors `ControlCommand` in control.ts. */
sealed class ControlCommand {
    data class MockAdd(val rule: ParsedMockRule) : ControlCommand()
    data class MockRemove(val id: String) : ControlCommand()
    object MockClear : ControlCommand()
    data class BreakpointAdd(val breakpoint: ParsedBreakpoint) : ControlCommand()
    data class BreakpointRemove(val id: String) : ControlCommand()

    /**
     * Device -> host only. See [isDeviceToHostCommand]. A device must never
     * be asked to apply one of its own — see [applyControlCommand].
     */
    data class BreakpointPaused(
        val pauseId: String,
        val ruleId: String?,
        val phase: String,
        val device: String,
        val request: PausedRequestSnapshot,
        val response: PausedResponseSnapshot?,
    ) : ControlCommand()

    /** Host -> device. Releases a pause, optionally with edits matching the pause's own phase. */
    data class BreakpointResume(
        val pauseId: String,
        val requestEdits: RequestEditsWire?,
        val responseEdits: ResponseEditsWire?,
    ) : ControlCommand()

    /** Host -> device. */
    data class BreakpointAbort(val pauseId: String) : ControlCommand()

    data class ThrottleSet(
        val profile: String,
        val latencyMs: Long? = null,
        val downloadKbps: Long? = null,
    ) : ControlCommand()
}

/**
 * `breakpoint.paused` is the one command kind that travels device -> host;
 * every other kind travels host -> device. Single source of truth for that
 * split — a host-side sender must refuse to transmit a command this returns
 * `true` for.
 */
fun isDeviceToHostCommand(cmd: ControlCommand): Boolean = cmd is ControlCommand.BreakpointPaused

/** The paused request's context — present on every `breakpoint.paused` frame regardless of phase. */
data class PausedRequestSnapshot(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val body: String?,
)

/**
 * The paused response snapshot — present only when `phase` is `"response"`.
 * `body` is required (not optional): mirrors [PausedResponse.body], which is
 * always a string (already read from the real response before pausing).
 */
data class PausedResponseSnapshot(
    val status: Int,
    val headers: Map<String, String>,
    val body: String,
)

/** Wire edits to apply to a request-phase pause on resume. All fields optional — absent means "keep original". */
data class RequestEditsWire(
    val url: String? = null,
    val method: String? = null,
    val headers: Map<String, String>? = null,
    val body: String? = null,
)

/** Wire edits to apply to a response-phase pause on resume. All fields optional — absent means "keep original". */
data class ResponseEditsWire(
    val status: Int? = null,
    val headers: Map<String, String>? = null,
    val body: String? = null,
)

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

/** Validates `Map<String, String>` headers — every value must actually be a JSON string. */
private fun parseHeaders(v: JSONObject?): Map<String, String>? {
    if (v == null) return null
    val map = LinkedHashMap<String, String>()
    for (key in v.keys()) {
        map[key] = v.opt(key) as? String ?: return null
    }
    return map
}

private fun parsePausedRequestSnapshot(v: JSONObject?): PausedRequestSnapshot? {
    if (v == null) return null
    val url = v.optStringOrNull("url")
    if (url.isNullOrEmpty()) return null
    val method = v.optStringOrNull("method")
    if (method.isNullOrEmpty()) return null
    val headers = parseHeaders(if (v.hasNonNull("headers")) v.opt("headers") as? JSONObject else null) ?: return null
    val body = v.optStringOrNull("body")
    if (v.hasNonNull("body") && body == null) return null
    return PausedRequestSnapshot(url = url, method = method, headers = headers, body = body)
}

/** `response.body` is required (see [PausedResponseSnapshot]) — missing or non-string is malformed. */
private fun parsePausedResponseSnapshot(v: JSONObject?): PausedResponseSnapshot? {
    if (v == null) return null
    if (!v.hasNonNull("status")) return null
    val statusInt = when (val status = v.opt("status")) {
        is Int -> status
        is Long -> status.toInt()
        is Double -> if (status.isFinite()) status.toInt() else return null
        else -> return null
    }
    val headers = parseHeaders(if (v.hasNonNull("headers")) v.opt("headers") as? JSONObject else null) ?: return null
    val body = v.optStringOrNull("body") ?: return null
    return PausedResponseSnapshot(status = statusInt, headers = headers, body = body)
}

private fun parseRequestEditsWire(v: JSONObject?): RequestEditsWire? {
    if (v == null) return null
    val url = v.optStringOrNull("url")
    if (v.hasNonNull("url") && url == null) return null
    val method = v.optStringOrNull("method")
    if (v.hasNonNull("method") && method == null) return null
    var headers: Map<String, String>? = null
    if (v.hasNonNull("headers")) {
        headers = parseHeaders(v.opt("headers") as? JSONObject) ?: return null
    }
    val body = v.optStringOrNull("body")
    if (v.hasNonNull("body") && body == null) return null
    return RequestEditsWire(url = url, method = method, headers = headers, body = body)
}

private fun parseResponseEditsWire(v: JSONObject?): ResponseEditsWire? {
    if (v == null) return null
    var status: Int? = null
    if (v.hasNonNull("status")) {
        status = when (val raw = v.opt("status")) {
            is Int -> raw
            is Long -> raw.toInt()
            is Double -> if (raw.isFinite()) raw.toInt() else return null
            else -> return null
        }
    }
    var headers: Map<String, String>? = null
    if (v.hasNonNull("headers")) {
        headers = parseHeaders(v.opt("headers") as? JSONObject) ?: return null
    }
    val body = v.optStringOrNull("body")
    if (v.hasNonNull("body") && body == null) return null
    return ResponseEditsWire(status = status, headers = headers, body = body)
}

private fun parseBreakpointPausedCommand(raw: JSONObject): ControlCommand? {
    val pauseId = raw.optStringOrNull("pauseId")
    if (!isPauseId(pauseId)) return null

    var ruleId: String? = null
    if (raw.hasNonNull("ruleId")) {
        ruleId = raw.opt("ruleId") as? String
        if (!isExternalId(ruleId)) return null
    }

    val phase = raw.optStringOrNull("phase")
    if (phase == null || phase !in PAUSE_PHASES) return null

    val device = raw.optStringOrNull("device")
    if (device.isNullOrEmpty() || device.length > MAX_DEVICE_LEN) return null

    val requestObj = if (raw.hasNonNull("request")) raw.opt("request") as? JSONObject else null
    val request = parsePausedRequestSnapshot(requestObj) ?: return null

    var response: PausedResponseSnapshot? = null
    if (raw.hasNonNull("response")) {
        response = parsePausedResponseSnapshot(raw.opt("response") as? JSONObject) ?: return null
    }

    return ControlCommand.BreakpointPaused(
        pauseId = requireNotNull(pauseId),
        ruleId = ruleId,
        phase = phase,
        device = device,
        request = request,
        response = response,
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
            "breakpoint.paused" -> parseBreakpointPausedCommand(raw)
            "breakpoint.resume" -> {
                val pauseId = raw.optStringOrNull("pauseId")
                if (!isPauseId(pauseId)) return null

                var requestEdits: RequestEditsWire? = null
                if (raw.hasNonNull("requestEdits")) {
                    requestEdits = parseRequestEditsWire(raw.opt("requestEdits") as? JSONObject) ?: return null
                }
                var responseEdits: ResponseEditsWire? = null
                if (raw.hasNonNull("responseEdits")) {
                    responseEdits = parseResponseEditsWire(raw.opt("responseEdits") as? JSONObject) ?: return null
                }

                ControlCommand.BreakpointResume(
                    pauseId = requireNotNull(pauseId),
                    requestEdits = requestEdits,
                    responseEdits = responseEdits,
                )
            }
            "breakpoint.abort" -> {
                val pauseId = raw.optStringOrNull("pauseId")
                if (!isPauseId(pauseId)) return null
                ControlCommand.BreakpointAbort(requireNotNull(pauseId))
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
 * Releases a pause. [RequestEditsWire]/[ResponseEditsWire] are partial (every
 * field means "keep original if absent" — mirrors TS's `Partial<PausedRequest>`),
 * but [BreakpointEngine.resumeRequest]/[BreakpointEngine.resumeResponse] take
 * full replacement edit objects — so this looks up the pause's own original
 * snapshot via [BreakpointEngine.getPaused] and merges each wire field over
 * it before calling the engine, matching how `control.ts`'s
 * `decideBreakpointRequest` merges `edits.url ?? request.url` etc. An unknown
 * pauseId is a silent no-op, mirroring the TS engine's `resume()`.
 */
private fun applyBreakpointResume(cmd: ControlCommand.BreakpointResume) {
    val entry = BreakpointEngine.shared.getPaused().find { it.id == cmd.pauseId } ?: return
    when (entry.phase) {
        PausedPhase.REQUEST -> {
            val original = entry.request ?: return
            val merged = PausedRequestEdits(
                url = cmd.requestEdits?.url ?: original.url,
                method = cmd.requestEdits?.method ?: original.method,
                headers = cmd.requestEdits?.headers ?: original.headers,
                body = cmd.requestEdits?.body ?: original.body,
            )
            BreakpointEngine.shared.resumeRequest(cmd.pauseId, merged)
        }
        PausedPhase.RESPONSE -> {
            val original = entry.response ?: return
            val merged = PausedResponseEdits(
                status = cmd.responseEdits?.status ?: original.status,
                headers = cmd.responseEdits?.headers ?: original.headers,
                body = cmd.responseEdits?.body ?: original.body,
            )
            BreakpointEngine.shared.resumeResponse(cmd.pauseId, merged)
        }
    }
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
            is ControlCommand.BreakpointPaused -> {
                // Device-to-host only (see isDeviceToHostCommand) — a device
                // applying its own pause notification is a protocol bug, not
                // something to silently no-op. Still must never throw.
                ControlApplyResult.Failure("breakpoint.paused travels device to host only; a device must never apply it")
            }
            is ControlCommand.BreakpointResume -> {
                applyBreakpointResume(cmd)
                ControlApplyResult.Success
            }
            is ControlCommand.BreakpointAbort -> {
                BreakpointEngine.shared.abort(cmd.pauseId)
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
