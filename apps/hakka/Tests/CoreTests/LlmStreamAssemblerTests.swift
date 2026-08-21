import HakkaCommon
import Testing

@testable import HakkaCore

@Suite("assembleOpenAiStream — pinned fixture transcript")
struct OpenAiStreamAssemblerTests {
    @Test("joins content deltas into the final text")
    func joinsContentDeltas() throws {
        let assembled = assembleOpenAiStream(SseEventParser.parse(try SseFixtures.read("openai-chat-chunks.sse")))

        #expect(assembled.text == "The capital of France is Paris.")
    }

    @Test("reassembles delta.tool_calls fragments — id and name from the first fragment, arguments concatenated")
    func reassemblesToolCallFragments() throws {
        let assembled = assembleOpenAiStream(SseEventParser.parse(try SseFixtures.read("openai-chat-chunks.sse")))

        #expect(assembled.toolCalls == [
            AssembledToolCall(id: "call_wx001", name: "get_weather", arguments: #"{"city":"Paris","unit":"celsius"}"#),
        ])
    }

    @Test("carries the terminal finish reason, model, and honest event count (data: [DONE] included)")
    func carriesTerminalFacts() throws {
        let assembled = assembleOpenAiStream(SseEventParser.parse(try SseFixtures.read("openai-chat-chunks.sse")))

        #expect(assembled.finishReason == "tool_calls")
        #expect(assembled.model == "gpt-4o-2024-08-06")
        #expect(assembled.eventCount == 9)
    }

    @Test("keeps two interleaved tool calls separate and in index order")
    func accumulatesByIndex() {
        let body = [
            "data: {\"model\":\"gpt-4o\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"id\":\"call_b\",\"type\":\"function\",\"function\":{\"name\":\"second\",\"arguments\":\"[2\"}}]}}]}",
            "",
            "data: {\"model\":\"gpt-4o\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_a\",\"type\":\"function\",\"function\":{\"name\":\"first\",\"arguments\":\"[1\"}}]}}]}",
            "",
            "data: {\"model\":\"gpt-4o\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"function\":{\"arguments\":\", 4]\"}}]}}]}",
            "",
            "data: {\"model\":\"gpt-4o\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\", 3]\"}}]}}]}",
            "",
        ].joined(separator: "\n")

        let assembled = assembleOpenAiStream(SseEventParser.parse(body))

        #expect(assembled.toolCalls == [
            AssembledToolCall(id: "call_a", name: "first", arguments: "[1, 3]"),
            AssembledToolCall(id: "call_b", name: "second", arguments: "[2, 4]"),
        ])
    }

    @Test("tolerates a stream cut mid-arguments — the fragment is shown, never thrown on")
    func toleratesCutStream() throws {
        let full = try SseFixtures.read("openai-chat-chunks.sse")
        // Whole records up through the FIRST arguments fragment only — the
        // rest of the stream (second fragment, finish chunk, usage, [DONE])
        // never arrives.
        let cut = full.components(separatedBy: "\n\n").prefix(5).joined(separator: "\n\n")

        let assembled = assembleOpenAiStream(SseEventParser.parse(cut))

        #expect(assembled.text == "The capital of France is Paris.")
        #expect(assembled.toolCalls == [
            AssembledToolCall(id: "call_wx001", name: "get_weather", arguments: #"{"ci"#),
        ])
        #expect(assembled.finishReason == nil)
    }
}

@Suite("assembleAnthropicStream — pinned fixture transcript")
struct AnthropicStreamAssemblerTests {
    @Test("joins text_delta events into the final text")
    func joinsTextDeltas() throws {
        let assembled = assembleAnthropicStream(SseEventParser.parse(try SseFixtures.read("anthropic-messages.sse")))

        #expect(assembled.text == "The capital of France is Paris.")
    }

    @Test("reassembles a tool_use block from its input_json_delta fragments")
    func reassemblesToolUseBlock() throws {
        let assembled = assembleAnthropicStream(SseEventParser.parse(try SseFixtures.read("anthropic-messages.sse")))

        #expect(assembled.toolCalls == [
            AssembledToolCall(id: "toolu_hakka001", name: "get_weather", arguments: #"{"city":"Paris","unit":"celsius"}"#),
        ])
    }

    @Test("carries message_start model, message_delta stop reason, and the full event count (pings included)")
    func carriesMessageFacts() throws {
        let assembled = assembleAnthropicStream(SseEventParser.parse(try SseFixtures.read("anthropic-messages.sse")))

        #expect(assembled.model == "claude-sonnet-4-5-20250929")
        #expect(assembled.finishReason == "tool_use")
        #expect(assembled.eventCount == 12)
    }
}

@Suite("stream assemblers — plain (non-LLM) event streams")
struct StreamAssemblersPlainStreamTests {
    @Test("assemble to empty content with an honest event count, rather than throwing", arguments: [true, false])
    func assemblesPlainStreamToEmpty(openAi: Bool) throws {
        let events = SseEventParser.parse(try SseFixtures.read("plain-events.sse"))
        let assembled = openAi ? assembleOpenAiStream(events) : assembleAnthropicStream(events)

        #expect(assembled.text.isEmpty)
        #expect(assembled.toolCalls.isEmpty)
        #expect(assembled.finishReason == nil)
        #expect(assembled.model == nil)
        #expect(assembled.eventCount == 4)
    }
}
