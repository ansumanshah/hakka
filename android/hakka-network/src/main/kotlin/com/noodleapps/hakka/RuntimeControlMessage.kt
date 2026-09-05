package com.noodleapps.hakka

import org.json.JSONArray
import org.json.JSONObject

/** Runtime-control v1 wire messages shared by bridge peers. */
internal sealed class RuntimeControlMessage {
    data class Hello(
        val role: String,
        val runtime: String,
        val capabilities: Set<RuntimeCapability>,
    ) : RuntimeControlMessage()

    data class Welcome(val targetId: String) : RuntimeControlMessage()

    data class Targets(val targets: List<RuntimeTarget>) : RuntimeControlMessage()

    data class Request(
        val commandId: String,
        val targetId: String,
        val command: ControlCommand,
    ) : RuntimeControlMessage()

    data class Result(
        val commandId: String,
        val targetId: String,
        val status: String,
        val error: RuntimeControlError? = null,
    ) : RuntimeControlMessage()
}

internal enum class RuntimeCapability(val wireValue: String) {
    MOCK_ADD("mock.add"),
    MOCK_REMOVE("mock.remove"),
    MOCK_CLEAR("mock.clear"),
    BREAKPOINT_ADD("breakpoint.add"),
    BREAKPOINT_REMOVE("breakpoint.remove"),
    BREAKPOINT_RESUME("breakpoint.resume"),
    BREAKPOINT_ABORT("breakpoint.abort"),
    THROTTLE_SET("throttle.set"),
    REQUEST_REPLAY("request.replay"),
    ;

    companion object {
        fun fromWireValue(value: String): RuntimeCapability? = entries.find { it.wireValue == value }
    }
}

internal enum class RuntimeControlError(val wireValue: String) {
    UNSUPPORTED_CAPABILITY("unsupported_capability"),
    TARGET_DISCONNECTED("target_disconnected"),
    APPLY_FAILED("apply_failed"),
    LEGACY_UNACKNOWLEDGED("legacy_unacknowledged"),
    TARGET_NOT_FOUND("target_not_found"),
    TIMEOUT("timeout"),
    TARGET_REQUIRED("target_required"),
    BRIDGE_DISCONNECTED("bridge_disconnected"),
    ;

    companion object {
        fun fromWireValue(value: String): RuntimeControlError? = entries.find { it.wireValue == value }
    }
}

internal data class RuntimeTarget(
    val id: String,
    val runtime: String,
    val capabilities: Set<RuntimeCapability>,
    val acknowledged: Boolean,
)

internal val ANDROID_RUNTIME_CAPABILITIES = setOf(
    RuntimeCapability.MOCK_ADD,
    RuntimeCapability.MOCK_REMOVE,
    RuntimeCapability.MOCK_CLEAR,
    RuntimeCapability.BREAKPOINT_ADD,
    RuntimeCapability.BREAKPOINT_REMOVE,
    RuntimeCapability.BREAKPOINT_RESUME,
    RuntimeCapability.BREAKPOINT_ABORT,
    RuntimeCapability.THROTTLE_SET,
)

private val RUNTIME_CONTROL_ID = Regex("^[A-Za-z0-9_-]{1,64}$")
private val RUNTIME_KINDS = setOf("browser", "react-native", "ios", "android", "server", "edge", "unknown")

/** Strict, additive parser for runtime-control v1. Malformed and unknown frames return null. */
internal fun parseRuntimeControlMessage(text: String): RuntimeControlMessage? = try {
    parseRuntimeControlMessage(JSONObject(text))
} catch (_: Exception) {
    null
}

internal fun parseRuntimeControlMessage(envelope: JSONObject?): RuntimeControlMessage? {
    if (envelope == null) return null
    return try {
        val type = envelope.opt("type") as? String ?: return null
        val payload = envelope.opt("payload") as? JSONObject ?: return null
        when (type) {
            "runtime.hello" -> parseHello(payload)
            "runtime.welcome" -> payload.requiredId("targetId")?.let(RuntimeControlMessage::Welcome)
            "runtime.targets" -> parseTargets(payload)
            "control.request" -> parseRequest(payload)
            "control.result" -> parseResult(payload)
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

internal fun buildRuntimeHelloFrame(): String = JSONObject()
    .put("type", "runtime.hello")
    .put(
        "payload",
        JSONObject()
            .put("role", "runtime")
            .put("runtime", "android")
            .put("protocolVersion", 1)
            .put("capabilities", JSONArray(ANDROID_RUNTIME_CAPABILITIES.map(RuntimeCapability::wireValue))),
    )
    .toString()

internal fun buildRuntimeControlResultFrame(result: RuntimeControlMessage.Result): String {
    val payload = JSONObject()
        .put("commandId", result.commandId)
        .put("targetId", result.targetId)
        .put("status", result.status)
    result.error?.let { payload.put("error", it.wireValue) }
    return JSONObject().put("type", "control.result").put("payload", payload).toString()
}

private fun parseHello(payload: JSONObject): RuntimeControlMessage.Hello? {
    val role = payload.opt("role") as? String ?: return null
    if (role != "runtime" && role != "controller") return null
    val runtime = payload.opt("runtime") as? String ?: return null
    if (runtime !in RUNTIME_KINDS || payload.opt("protocolVersion") != 1) return null
    return parseCapabilities(payload.opt("capabilities") as? JSONArray)?.let {
        RuntimeControlMessage.Hello(role, runtime, it)
    }
}

private fun parseTargets(payload: JSONObject): RuntimeControlMessage.Targets? {
    val values = payload.opt("targets") as? JSONArray ?: return null
    if (values.length() > 1024) return null
    val targets = buildList {
        for (index in 0 until values.length()) {
            val target = values.opt(index) as? JSONObject ?: return null
            val id = target.requiredId("id") ?: return null
            val runtime = target.opt("runtime") as? String ?: return null
            val capabilities = parseCapabilities(target.opt("capabilities") as? JSONArray) ?: return null
            val acknowledged = target.opt("acknowledged") as? Boolean ?: return null
            if (runtime !in RUNTIME_KINDS) return null
            add(RuntimeTarget(id, runtime, capabilities, acknowledged))
        }
    }
    return RuntimeControlMessage.Targets(targets)
}

private fun parseRequest(payload: JSONObject): RuntimeControlMessage.Request? {
    val commandId = payload.requiredId("commandId") ?: return null
    val targetId = payload.requiredId("targetId") ?: return null
    val timeoutMs = payload.opt("timeoutMs")
    if (timeoutMs !is Int || timeoutMs !in 1..30_000) return null
    val command = parseControlCommand(payload.opt("command") as? JSONObject) ?: return null
    if (isDeviceToHostCommand(command)) return null
    return RuntimeControlMessage.Request(commandId, targetId, command)
}

private fun parseResult(payload: JSONObject): RuntimeControlMessage.Result? {
    val commandId = payload.requiredId("commandId") ?: return null
    val targetId = payload.requiredId("targetId") ?: return null
    return when (val status = payload.opt("status") as? String) {
        "applied" -> if (payload.has("error")) null else RuntimeControlMessage.Result(commandId, targetId, status)
        "failed" -> {
            val error = payload.opt("error") as? String ?: return null
            RuntimeControlError.fromWireValue(error)?.let { RuntimeControlMessage.Result(commandId, targetId, status, it) }
        }
        else -> null
    }
}

private fun parseCapabilities(values: JSONArray?): Set<RuntimeCapability>? {
    if (values == null || values.length() > RuntimeCapability.entries.size) return null
    val capabilities = buildSet {
        for (index in 0 until values.length()) {
            val capability = values.opt(index) as? String ?: return null
            add(RuntimeCapability.fromWireValue(capability) ?: return null)
        }
    }
    return capabilities.takeIf { it.size == values.length() }
}

private fun JSONObject.requiredId(name: String): String? =
    (opt(name) as? String)?.takeIf(RUNTIME_CONTROL_ID::matches)
