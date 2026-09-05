package com.noodleapps.hakka

import java.util.LinkedHashMap

/**
 * Applies acknowledged runtime-control requests for one bridge connection.
 *
 * The hub assigns [targetId] through `runtime.welcome`; requests for any other target are
 * ignored. Completed command IDs are kept per connection so reconnects never inherit a stale
 * identity and duplicate frames cannot reapply a mutation.
 */
internal class RuntimeControlHandler(
    private val capabilities: Set<RuntimeCapability> = ANDROID_RUNTIME_CAPABILITIES,
    private val applyCommand: (ControlCommand) -> ControlApplyResult = ::applyControlCommand,
) {
    private companion object {
        const val COMPLETED_COMMAND_LIMIT = 256
    }

    private var targetId: String? = null
    private val completed = object : LinkedHashMap<String, RuntimeControlMessage.Result>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, RuntimeControlMessage.Result>?): Boolean =
            size > COMPLETED_COMMAND_LIMIT
    }

    @Synchronized
    fun beginConnection() {
        targetId = null
        completed.clear()
    }

    @Synchronized
    fun handle(text: String): RuntimeControlDispatch {
        return when (val message = parseRuntimeControlMessage(text)) {
            null -> RuntimeControlDispatch.Unhandled
            is RuntimeControlMessage.Welcome -> {
                if (targetId != message.targetId) completed.clear()
                targetId = message.targetId
                RuntimeControlDispatch.Handled
            }
            is RuntimeControlMessage.Request -> applyRequest(message)
            else -> RuntimeControlDispatch.Handled
        }
    }

    private fun applyRequest(request: RuntimeControlMessage.Request): RuntimeControlDispatch {
        if (request.targetId != targetId) return RuntimeControlDispatch.Handled
        completed[request.commandId]?.let { return RuntimeControlDispatch.Result(it) }

        val capability = capabilityFor(request.command)
        val result = if (capability !in capabilities) {
            RuntimeControlMessage.Result(
                commandId = request.commandId,
                targetId = request.targetId,
                status = "failed",
                error = RuntimeControlError.UNSUPPORTED_CAPABILITY,
            )
        } else {
            when (applyCommand(request.command)) {
                ControlApplyResult.Success -> RuntimeControlMessage.Result(request.commandId, request.targetId, "applied")
                is ControlApplyResult.Failure -> RuntimeControlMessage.Result(
                    commandId = request.commandId,
                    targetId = request.targetId,
                    status = "failed",
                    error = RuntimeControlError.APPLY_FAILED,
                )
            }
        }
        completed[request.commandId] = result
        return RuntimeControlDispatch.Result(result)
    }
}

internal sealed class RuntimeControlDispatch {
    object Unhandled : RuntimeControlDispatch()
    object Handled : RuntimeControlDispatch()
    data class Result(val value: RuntimeControlMessage.Result) : RuntimeControlDispatch()
}

private fun capabilityFor(command: ControlCommand): RuntimeCapability = when (command) {
    is ControlCommand.MockAdd -> RuntimeCapability.MOCK_ADD
    is ControlCommand.MockRemove -> RuntimeCapability.MOCK_REMOVE
    ControlCommand.MockClear -> RuntimeCapability.MOCK_CLEAR
    is ControlCommand.BreakpointAdd -> RuntimeCapability.BREAKPOINT_ADD
    is ControlCommand.BreakpointRemove -> RuntimeCapability.BREAKPOINT_REMOVE
    is ControlCommand.BreakpointResume -> RuntimeCapability.BREAKPOINT_RESUME
    is ControlCommand.BreakpointAbort -> RuntimeCapability.BREAKPOINT_ABORT
    is ControlCommand.ThrottleSet -> RuntimeCapability.THROTTLE_SET
    is ControlCommand.BreakpointPaused -> error("Device-to-host commands are rejected by the runtime-control parser")
}
