import HakkaCommon
import HakkaCore
import SwiftUI

/// The SSE tab: an event-stream response rendered as an assembled LLM
/// message (deltas joined, tool calls reassembled) above a collapsible raw
/// event list. Assembly is provider-aware — OpenAI-family chunks and
/// Anthropic events join into a final message; Gemini/unknown streams have
/// no delta grammar to join and show the raw events alone.
struct DetailSseTabView: View {
    @State private var showsRawEvents = false
    /// Parsed/assembled lazily by `.task(id:)` below, keyed to `record.id` —
    /// not eagerly in `init`, which reran on every ancestor re-render (any
    /// observed `AppModel` field, not just the selected record), re-parsing
    /// a potentially large event stream on the main thread each time.
    @State private var events: [SseEvent] = []
    @State private var assembled: AssembledStream?

    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SseSummaryHeader(eventCount: events.count, assembled: assembled)
            if let assembled {
                AssembledMessageSection(assembled: assembled)
            }
            RawEventList(events: events, isExpanded: $showsRawEvents)
        }
        .task(id: record.id) {
            let parsed = SseEventParser.parse(record.responseBody)
            events = parsed
            assembled = Self.assemble(provider: detectLlmProvider(url: record.url)?.id, events: parsed)
        }
    }

    /// OpenAI's chunk grammar is shared by every OpenAI-compatible gateway;
    /// Gemini and unknown hosts have no delta grammar to join.
    private static func assemble(provider: LlmProvider.ID?, events: [SseEvent]) -> AssembledStream? {
        switch provider {
        case .anthropic:
            assembleAnthropicStream(events)
        case .openai, .azureOpenAI, .openrouter, .groq, .mistral:
            assembleOpenAiStream(events)
        case nil, .gemini:
            nil
        }
    }
}

/// One header line: the true event count, the model the stream announced,
/// and the finish/stop reason as a tag.
private struct SseSummaryHeader: View {
    let eventCount: Int
    let assembled: AssembledStream?

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text("\(eventCount) events")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let model = assembled?.model {
                Text(model)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }
            if let finishReason = assembled?.finishReason {
                Text(finishReason)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(ThemeTokens.Status.info)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, Spacing.xxs)
                    .background(ThemeTokens.Status.info.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            Spacer()
        }
    }
}

/// The joined assistant message: text deltas as one block, then each
/// reassembled tool call with pretty-printed arguments.
private struct AssembledMessageSection: View {
    let assembled: AssembledStream

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Assembled message")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            messageBlock
            if !assembled.toolCalls.isEmpty {
                Text("Tool calls (\(assembled.toolCalls.count))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(Array(assembled.toolCalls.enumerated()), id: \.offset) { _, call in
                    ToolCallBlock(call: call)
                }
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private var messageBlock: some View {
        if assembled.text.isEmpty {
            Text("No text content in this stream")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            Text(assembled.text)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One reassembled tool call: its name (or id), then the arguments —
/// pretty-printed when they parse, verbatim when the stream was cut
/// mid-fragment.
private struct ToolCallBlock: View {
    let call: AssembledToolCall

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(call.name ?? call.id ?? "(unnamed call)")
                .font(.system(.caption, design: .monospaced).weight(.semibold))
            Text(JSONPrettyPrinter.prettyPrinted(call.arguments) ?? call.arguments)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

/// The collapsible raw event list — each event's name/id line above its
/// data, capped in the DOM-bounding sense: a long token stream can carry
/// thousands of events, and the count in the header stays the true total.
private struct RawEventList: View {
    private static let maxRenderedEvents = 100

    let events: [SseEvent]
    @Binding var isExpanded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Button {
                isExpanded.toggle()
            } label: {
                Label("Raw events (\(events.count))", systemImage: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            if isExpanded {
                ForEach(Array(shownEvents.enumerated()), id: \.offset) { index, event in
                    RawEventRow(number: index + 1, event: event)
                }
                if hiddenCount > 0 {
                    Text("… \(hiddenCount) more events not shown")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var shownEvents: [SseEvent] { Array(events.prefix(Self.maxRenderedEvents)) }
    private var hiddenCount: Int { events.count - shownEvents.count }
}

/// One raw event: `#n event-name` above the untouched data line.
private struct RawEventRow: View {
    let number: Int
    let event: SseEvent

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.tertiary)
            Text(event.data)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var label: String {
        event.event.map { "#\(number) \($0)" } ?? "#\(number)"
    }
}
