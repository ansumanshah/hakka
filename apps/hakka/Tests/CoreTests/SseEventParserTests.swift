import HakkaCommon
import Testing

@testable import HakkaCore

@Suite("SseEventParser — pinned plain-events fixture")
struct SseEventParserTests {
    @Test("splits records on blank lines, keeping the comment out but the retry-only record in")
    func parsesPlainEventsFixture() throws {
        let events = SseEventParser.parse(try SseFixtures.read("plain-events.sse"))

        #expect(events.map(\.event) == [nil, "status", "log", "done"])
        #expect(events.map(\.id) == [nil, "1", "2", "3"])
        #expect(events.first?.retry == 3_000)
    }

    @Test("joins multi-line data with newlines")
    func joinsMultiLineData() throws {
        let events = SseEventParser.parse(try SseFixtures.read("plain-events.sse"))
        let log = events[2]

        #expect(log.data == "{\"line\":\"step 1 complete\"}\n{\"line\":\"step 2 complete\"}")
    }

    @Test("counts the pinned provider transcripts exactly")
    func countsProviderTranscripts() throws {
        #expect(SseEventParser.parse(try SseFixtures.read("openai-chat-chunks.sse")).count == 9)
        #expect(SseEventParser.parse(try SseFixtures.read("anthropic-messages.sse")).count == 12)
    }

    @Test("absent body parses to no events")
    func absentBodyParsesToNoEvents() {
        #expect(SseEventParser.parse(nil).isEmpty)
        #expect(SseEventParser.parse("").isEmpty)
    }

    @Test("recognizes event-stream content types, parameters and case aside", arguments: [
        ("text/event-stream", true),
        ("text/event-stream; charset=utf-8", true),
        ("TEXT/EVENT-STREAM", true),
        ("application/json", false),
        ("text/plain", false),
        (nil as String?, false),
    ])
    func recognizesEventStreamContentTypes(contentType: String?, expected: Bool) {
        #expect(SseEventParser.isEventStream(contentType: contentType) == expected)
    }
}
