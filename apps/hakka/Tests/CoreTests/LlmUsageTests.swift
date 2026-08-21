import Testing

@testable import HakkaCore

@Suite("parseLlmUsage — streaming bodies (pinned fixtures)")
struct LlmUsageStreamTests {
    @Test("reads the FINAL usage chunk from an OpenAI stream")
    func readsOpenAiFinalUsageChunk() throws {
        let usage = parseLlmUsage(try SseFixtures.read("openai-chat-chunks.sse"), provider: .openai)

        #expect(usage == LlmUsage(
            promptTokens: 25,
            completionTokens: 48,
            totalTokens: 73,
            model: "gpt-4o-2024-08-06"
        ))
    }

    @Test("combines Anthropic message_start input tokens with message_delta output tokens, deriving the total")
    func mergesAnthropicInputAndOutputTokens() throws {
        let usage = parseLlmUsage(try SseFixtures.read("anthropic-messages.sse"), provider: .anthropic)

        // The total is not on the Anthropic wire — prompt + completion.
        #expect(usage == LlmUsage(
            promptTokens: 25,
            completionTokens: 48,
            totalTokens: 73,
            model: "claude-sonnet-4-5-20250929"
        ))
    }

    @Test("returns nil for a plain (non-LLM) event stream")
    func returnsNilForPlainEventStream() throws {
        #expect(parseLlmUsage(try SseFixtures.read("plain-events.sse")) == nil)
    }

    @Test("sniffs the wire family without a provider hint (OpenAI-compatible proxies on unknown hosts)")
    func sniffsFamilyWithoutProviderHint() throws {
        let openAi = parseLlmUsage(try SseFixtures.read("openai-chat-chunks.sse"))
        #expect(openAi?.totalTokens == 73)

        let anthropic = parseLlmUsage(try SseFixtures.read("anthropic-messages.sse"))
        #expect(anthropic?.promptTokens == 25)
    }

    @Test("reports model-only while a stream is still mid-flight (no usage chunk yet)")
    func reportsModelOnlyMidStream() {
        let body = "data: {\"model\":\"gpt-4o-2024-08-06\",\"choices\":[{\"delta\":{\"content\":\"par\"}}]}\n\n"

        #expect(parseLlmUsage(body, provider: .openai) == LlmUsage(model: "gpt-4o-2024-08-06"))
    }

    @Test("parses a Gemini stream whose final chunk carries the completed usageMetadata (last-wins)")
    func geminiStreamLastWins() {
        let body = [
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"he\"}]}}],\"usageMetadata\":{\"promptTokenCount\":9,\"candidatesTokenCount\":2,\"totalTokenCount\":11},\"modelVersion\":\"gemini-2.0-flash\"}",
            "",
            "data: {\"candidates\":[],\"usageMetadata\":{\"promptTokenCount\":9,\"candidatesTokenCount\":12,\"totalTokenCount\":21},\"modelVersion\":\"gemini-2.0-flash\"}",
            "",
        ].joined(separator: "\n")

        #expect(parseLlmUsage(body, provider: .gemini) == LlmUsage(
            promptTokens: 9,
            completionTokens: 12,
            totalTokens: 21,
            model: "gemini-2.0-flash"
        ))
    }
}

@Suite("parseLlmUsage — non-streaming JSON bodies")
struct LlmUsageJsonTests {
    @Test("parses the OpenAI response shape")
    func parsesOpenAiShape() {
        let body = #"{"id":"chatcmpl-1","model":"gpt-4o-2024-08-06","usage":{"prompt_tokens":9,"completion_tokens":12,"total_tokens":21}}"#

        #expect(parseLlmUsage(body, provider: .openai) == LlmUsage(
            promptTokens: 9,
            completionTokens: 12,
            totalTokens: 21,
            model: "gpt-4o-2024-08-06"
        ))
    }

    @Test("parses the Anthropic response shape (input/output naming, total derived)")
    func parsesAnthropicShape() {
        let body = #"{"id":"msg_1","model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":9,"output_tokens":12}}"#

        #expect(parseLlmUsage(body, provider: .anthropic) == LlmUsage(
            promptTokens: 9,
            completionTokens: 12,
            totalTokens: 21,
            model: "claude-sonnet-4-5-20250929"
        ))
    }

    @Test("parses the Gemini response shape (usageMetadata + modelVersion)")
    func parsesGeminiShape() {
        let body = #"{"candidates":[{"content":{"parts":[{"text":"hi"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":12,"totalTokenCount":21},"modelVersion":"gemini-2.0-flash"}"#

        #expect(parseLlmUsage(body, provider: .gemini) == LlmUsage(
            promptTokens: 9,
            completionTokens: 12,
            totalTokens: 21,
            model: "gemini-2.0-flash"
        ))
    }

    @Test("returns nil on bodies with no usage and no model, without throwing", arguments: [
        "{\"ok\":true}",
        "not json at all",
        "",
        nil as String?,
    ])
    func returnsNilOnBareBodies(body: String?) {
        #expect(parseLlmUsage(body) == nil)
    }
}
