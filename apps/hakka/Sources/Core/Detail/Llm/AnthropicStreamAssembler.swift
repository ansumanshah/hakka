import Foundation
import HakkaCommon

/// Assembles an Anthropic Messages API event stream into its final message:
/// `content_block_delta` text deltas join into text, a `tool_use` block's
/// `input_json_delta` fragments concatenate into its input JSON (blocks are
/// indexed, so interleaved blocks stay separate), `message_start` carries
/// the model, and `message_delta` the stop reason. Unrelated events (`ping`,
/// unknown types) are skipped, never thrown on.
public func assembleAnthropicStream(_ events: [SseEvent]) -> AssembledStream {
    var text = ""
    var finishReason: String?
    var model: String?
    var blocks: [Int: ToolBlockSlot] = [:]

    for event in events {
        guard let payload = payloadObject(event.data) else { continue }

        switch payload["type"] as? String {
        case "message_start":
            if model == nil,
               let message = payload["message"] as? [String: Any],
               let reportedModel = message["model"] as? String {
                model = reportedModel
            }
        case "content_block_start":
            startToolBlock(payload, into: &blocks)
        case "content_block_delta":
            applyDelta(payload, into: &blocks, text: &text)
        case "message_delta":
            if let delta = payload["delta"] as? [String: Any],
               let stopReason = delta["stop_reason"] as? String {
                finishReason = stopReason
            }
        default:
            break
        }
    }

    let toolCalls = blocks.values
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

/// One tool-block accumulator, keyed by the stream's own content-block
/// index — fragments for the same block share it.
private struct ToolBlockSlot {
    var slot: Int
    var id: String?
    var name: String?
    var arguments: String
}

private func startToolBlock(_ payload: [String: Any], into blocks: inout [Int: ToolBlockSlot]) {
    guard let block = payload["content_block"] as? [String: Any],
          block["type"] as? String == "tool_use"
    else { return }
    let slot = (payload["index"] as? Int) ?? blocks.count
    blocks[slot] = ToolBlockSlot(
        slot: slot,
        id: block["id"] as? String,
        name: block["name"] as? String,
        arguments: ""
    )
}

private func applyDelta(_ payload: [String: Any], into blocks: inout [Int: ToolBlockSlot], text: inout String) {
    guard let delta = payload["delta"] as? [String: Any] else { return }
    if delta["type"] as? String == "text_delta", let chunk = delta["text"] as? String {
        text += chunk
    } else if delta["type"] as? String == "input_json_delta",
              let fragment = delta["partial_json"] as? String,
              let slot = payload["index"] as? Int,
              blocks[slot] != nil {
        blocks[slot]!.arguments += fragment
    }
}

private func payloadObject(_ data: String) -> [String: Any]? {
    guard let bytes = data.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: bytes),
          let object = parsed as? [String: Any]
    else { return nil }
    return object
}
