/// Shapes shared by the provider stream assemblers — what a
/// `text/event-stream` body adds up to once its deltas are joined.
/// Presenter-side only: nothing here feeds back into the record contract.

/// One tool call reassembled from its delta fragments, in call order.
public struct AssembledToolCall: Sendable, Equatable {
    /// Provider-assigned call id, when the wire carries one.
    public var id: String?
    /// Function/tool name.
    public var name: String?
    /// Concatenated raw arguments JSON — complete when the stream finished,
    /// a fragment mid-stream.
    public var arguments: String

    public init(id: String? = nil, name: String? = nil, arguments: String) {
        self.id = id
        self.name = name
        self.arguments = arguments
    }
}

/// The assembled result of an LLM event stream.
public struct AssembledStream: Sendable, Equatable {
    /// Every parsed SSE event, whatever its kind — data events, pings, named
    /// no-data events.
    public var eventCount: Int
    /// Assistant text: all text deltas joined in arrival order.
    public var text: String
    /// Tool calls in call order.
    public var toolCalls: [AssembledToolCall]
    /// Finish/stop reason verbatim from the wire (`stop`, `tool_calls`,
    /// `tool_use`, ...).
    public var finishReason: String?
    /// Model name as reported on the wire.
    public var model: String?

    public init(
        eventCount: Int,
        text: String,
        toolCalls: [AssembledToolCall],
        finishReason: String? = nil,
        model: String? = nil
    ) {
        self.eventCount = eventCount
        self.text = text
        self.toolCalls = toolCalls
        self.finishReason = finishReason
        self.model = model
    }
}
