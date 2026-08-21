import Foundation
import HakkaCommon

/// LLM token usage parsed out of a captured response body — tokens and the
/// model name only, never cost: a wrong number is worse than none, and
/// pricing is a moving target.
public struct LlmUsage: Sendable, Equatable {
    public var promptTokens: Int?
    public var completionTokens: Int?
    public var totalTokens: Int?
    public var model: String?

    public init(promptTokens: Int? = nil, completionTokens: Int? = nil, totalTokens: Int? = nil, model: String? = nil) {
        self.promptTokens = promptTokens
        self.completionTokens = completionTokens
        self.totalTokens = totalTokens
        self.model = model
    }
}

/// Which wire shape a provider uses for usage — several share the OpenAI one.
private enum LlmUsageFamily: String, Sendable {
    case openai
    case anthropic
    case gemini
}

private let familyByProvider: [LlmProvider.ID: LlmUsageFamily] = [
    .openai: .openai,
    .azureOpenAI: .openai,
    .openrouter: .openai,
    .groq: .openai,
    .mistral: .openai,
    .anthropic: .anthropic,
    .gemini: .gemini,
]

/// Field names per family — the only thing that differs between the shapes.
private struct LlmUsageFields {
    /// Key holding the token counts, on the response or the streaming
    /// fact-carrier.
    let counts: String
    let prompt: String
    let completion: String
    let total: String?
    /// Key holding the model name, on the response (Anthropic: on `message`).
    let model: String
}

private let familyFields: [LlmUsageFamily: LlmUsageFields] = [
    .openai: LlmUsageFields(
        counts: "usage", prompt: "prompt_tokens", completion: "completion_tokens",
        total: "total_tokens", model: "model"
    ),
    .anthropic: LlmUsageFields(
        counts: "usage", prompt: "input_tokens", completion: "output_tokens",
        total: nil, model: "model"
    ),
    .gemini: LlmUsageFields(
        counts: "usageMetadata", prompt: "promptTokenCount", completion: "candidatesTokenCount",
        total: "totalTokenCount", model: "modelVersion"
    ),
]

private let allFamilies: [LlmUsageFamily] = [.openai, .anthropic, .gemini]

private func readNonEmptyString(_ raw: Any?) -> String? {
    guard let string = raw as? String, !string.isEmpty else { return nil }
    return string
}

private func readTokenCount(_ raw: Any?) -> Int? {
    if raw is Bool { return nil }
    guard let number = raw as? NSNumber else { return nil }
    let double = number.doubleValue
    guard double.isFinite, let whole = Int(exactly: double) else { return nil }
    return whole
}

/// Read one family's usage off `value` (a response object, a chunk, an
/// Anthropic message).
private func readUsage(_ family: LlmUsageFamily, from value: [String: Any]) -> LlmUsage {
    let fields = familyFields[family]!
    var usage = LlmUsage()
    usage.model = readNonEmptyString(value[fields.model])
    if let counts = value[fields.counts] as? [String: Any] {
        usage.promptTokens = readTokenCount(counts[fields.prompt])
        usage.completionTokens = readTokenCount(counts[fields.completion])
        if let totalKey = fields.total {
            usage.totalTokens = readTokenCount(counts[totalKey])
        }
    }
    return usage
}

private func isEmptyUsage(_ usage: LlmUsage) -> Bool {
    usage.promptTokens == nil && usage.completionTokens == nil && usage.totalTokens == nil
}

/// Streaming events refine as they arrive (counts grow, output tokens
/// finalize), so token fields last-wins; the model is announced once, up
/// front.
private func mergeUsage(_ into: inout LlmUsage, from: LlmUsage) {
    if from.promptTokens != nil { into.promptTokens = from.promptTokens }
    if from.completionTokens != nil { into.completionTokens = from.completionTokens }
    if from.totalTokens != nil { into.totalTokens = from.totalTokens }
    if into.model == nil { into.model = from.model }
}

/// Fill the total from the two halves when the wire omits it — arithmetic,
/// not pricing.
private func withDerivedTotal(_ usage: LlmUsage) -> LlmUsage {
    guard usage.totalTokens == nil,
          let prompt = usage.promptTokens,
          let completion = usage.completionTokens
    else { return usage }
    var derived = usage
    derived.totalTokens = prompt + completion
    return derived
}

// MARK: - Event streams

/// True for event-stream bodies — a `data:`/`event:` line start, which no
/// provider's plain JSON response has.
private func looksLikeEventStream(_ text: String) -> Bool {
    text.split(separator: "\n", omittingEmptySubsequences: false).contains { line in
        let trimmed = line.drop { $0 == " " || $0 == "\t" }
        return trimmed.hasPrefix("data:") || trimmed.hasPrefix("event:")
    }
}

private func eventPayload(_ data: String) -> [String: Any]? {
    guard let bytes = data.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: bytes),
          let object = parsed as? [String: Any]
    else { return nil }
    return object
}

/// Fold an event stream's usage facts under one family's field names.
private func readEventStreamUsage(_ text: String, family: LlmUsageFamily) -> LlmUsage? {
    var merged = LlmUsage()
    for event in decodeSse(text) {
        guard let payload = eventPayload(event.data) else { continue }

        if family == .anthropic {
            // Anthropic splits its facts: message_start owns the model +
            // input tokens, message_delta finalizes output tokens.
            let type = payload["type"] as? String
            if type == "message_start", let message = payload["message"] as? [String: Any] {
                mergeUsage(&merged, from: readUsage(family, from: message))
            } else if type == "message_delta" {
                mergeUsage(&merged, from: readUsage(family, from: payload))
            }
            continue
        }
        mergeUsage(&merged, from: readUsage(family, from: payload))
    }
    return isEmptyUsage(merged) && merged.model == nil ? nil : merged
}

// MARK: - Entry

/// Parse token usage + model out of a response body. `provider` picks the
/// matching wire shape first; without it (or on a mismatch) every shape is
/// tried, so OpenAI-compatible endpoints behind unknown hosts still parse.
/// Returns `nil` when the body carries no usage and no model at all.
public func parseLlmUsage(_ text: String?, provider: LlmProvider.ID? = nil) -> LlmUsage? {
    guard let text, !text.isEmpty else { return nil }
    let families = orderedFamilies(preferred: provider.flatMap { familyByProvider[$0] })

    if looksLikeEventStream(text) {
        var best: LlmUsage?
        for family in families {
            guard let usage = readEventStreamUsage(text, family: family) else { continue }
            if !isEmptyUsage(usage) {
                best = usage
                break
            }
            if best == nil { best = usage } // model-only, before any tokens arrive
        }
        guard let chosen = best, !(isEmptyUsage(chosen) && chosen.model == nil) else { return nil }
        return withDerivedTotal(chosen)
    }

    guard let object = eventPayload(text) else { return nil }
    for family in families {
        let usage = readUsage(family, from: object)
        if !isEmptyUsage(usage) { return withDerivedTotal(usage) }
    }
    return nil
}

private func orderedFamilies(preferred: LlmUsageFamily?) -> [LlmUsageFamily] {
    guard let preferred else { return allFamilies }
    return [preferred] + allFamilies.filter { $0 != preferred }
}
