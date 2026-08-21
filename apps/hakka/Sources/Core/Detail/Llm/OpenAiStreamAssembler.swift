import Foundation
import HakkaCommon

/// Assembles an OpenAI-family `chat.completion.chunk` stream (the wire shape
/// also used by the OpenAI-compatible gateways) into its final message:
/// content deltas join into text, `delta.tool_calls` fragments accumulate
/// by their index into whole tool calls, and the terminal chunk's finish
/// reason and model carry through. Non-JSON events (keep-alives, provider
/// control lines) are skipped, never thrown on.
public func assembleOpenAiStream(_ events: [SseEvent]) -> AssembledStream {
    var text = ""
    var finishReason: String?
    var model: String?
    var slots: [Int: ToolCallSlot] = [:]

    for event in events {
        if event.data == "[DONE]" { continue }
        guard let chunk = chunkObject(event.data) else { continue }
        if model == nil { model = nonEmptyString(chunk["model"]) }
        guard let choices = chunk["choices"] as? [Any] else { continue }

        for case let choice as [String: Any] in choices {
            if let delta = choice["delta"] as? [String: Any] {
                if let content = delta["content"] as? String { text += content }
                if let calls = delta["tool_calls"] as? [Any] {
                    for case let call as [String: Any] in calls {
                        accumulateToolCall(call, into: &slots)
                    }
                }
            }
            if let reason = nonEmptyString(choice["finish_reason"]) {
                finishReason = reason
            }
        }
    }

    let toolCalls = slots.values
        .sorted { $0.slot < $1.slot }
        .map { AssembledToolCall(id: $0.id, name: $0.name, arguments: $0.arguments) }

    return AssembledStream(
        eventCount: events.count,
        text: text,
        toolCalls: toolCalls,
        finishReason: finishReason,
        model: model
    )
}

/// One tool-call accumulator, keyed by the stream's own tool-call index —
/// fragments for the same call share it.
private struct ToolCallSlot {
    var slot: Int
    var id: String?
    var name: String?
    var arguments: String
}

private func accumulateToolCall(_ call: [String: Any], into slots: inout [Int: ToolCallSlot]) {
    let slot = (call["index"] as? Int) ?? 0
    var accumulator = slots[slot] ?? ToolCallSlot(slot: slot, id: nil, name: nil, arguments: "")
    let function = call["function"] as? [String: Any]
    if let id = nonEmptyString(call["id"]) { accumulator.id = id }
    if let name = nonEmptyString(function?["name"]) { accumulator.name = name }
    if let arguments = function?["arguments"] as? String { accumulator.arguments += arguments }
    slots[slot] = accumulator
}

private func chunkObject(_ data: String) -> [String: Any]? {
    guard let bytes = data.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: bytes),
          let object = parsed as? [String: Any]
    else { return nil }
    return object
}

private func nonEmptyString(_ raw: Any?) -> String? {
    guard let string = raw as? String, !string.isEmpty else { return nil }
    return string
}
